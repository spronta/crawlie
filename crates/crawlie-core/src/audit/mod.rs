//! The audit pass: turn crawled `Page` data into actionable `Issue`s. Each rule
//! maps to a concrete best practice and to an entry in [`crate::knowledge`] that
//! explains *why* it matters and *how* to fix it.

use crate::types::*;
use std::collections::{HashMap, HashSet};
use url::Url;

const TITLE_MIN: usize = 30;
const TITLE_MAX: usize = 60;
const DESC_MIN: usize = 70;
const DESC_MAX: usize = 160;
const THIN_WORDS: usize = 200;
/// Minimum post-render words for `content-requires-js` to fire — enough that the
/// JS-delivered content is real, not an enhancement to an already-substantial page.
const JS_CONTENT_MIN: usize = 100;
const SLOW_MS: u64 = 2000;
const LARGE_BYTES: usize = 2_000_000;
const DEEP: usize = 4;
const GEO_READY: u8 = 70;
const H1_MAX: usize = 70;
/// Long pages without a single H2 read as an unstructured wall of text.
const H2_MIN_WORDS: usize = 600;
const URL_MAX: usize = 115;
/// Total outlinks (internal + external) beyond which link equity is diluted.
const MAX_OUTLINKS: usize = 200;

fn issue(
    rule: &str,
    title: &str,
    category: Category,
    severity: Severity,
    url: &str,
    detail: Option<String>,
) -> Issue {
    Issue {
        rule: rule.to_string(),
        title: title.to_string(),
        category,
        severity,
        url: url.to_string(),
        detail,
    }
}

fn norm(s: &str) -> String {
    match Url::parse(s) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => s.to_string(),
    }
}

/// Cross-page context an [`audit_one`] call needs: the titles, meta
/// descriptions and H1s that appear on more than one 200 page, plus URL
/// variants (case / trailing slash) crawled as separate pages. Owned (not
/// borrowed from the page slice) so the streaming crawl can build it from a
/// SQL query.
#[derive(Default)]
pub struct CrossPage {
    pub dup_title: HashSet<String>,
    pub dup_desc: HashSet<String>,
    /// First-H1 texts that appear on more than one 200 page.
    pub dup_h1: HashSet<String>,
    /// ASCII-lowercased URLs crawled under more than one case variant.
    pub dup_case: HashSet<String>,
    /// Trailing-slash-stripped URLs crawled both with and without the slash.
    pub dup_slash: HashSet<String>,
    /// Normalized URLs listed in the site's XML sitemaps, when a sitemap was
    /// found — enables the sitemap↔crawl cross-check rules. `None` disables
    /// them (no sitemap, or the caller didn't collect the set).
    pub in_sitemap: Option<HashSet<String>>,
    /// url → (canonical url, similarity %) for pages whose text near-
    /// duplicates an earlier page (simhash distance within threshold).
    pub near_dup: HashMap<String, (String, u8)>,
    /// hreflang alternates declared by each crawled 200 page (normalized page
    /// URL → normalized alternate hrefs). An empty set means the page was
    /// crawled and declares none — a missing entry means it wasn't crawled,
    /// so reciprocity can't be judged.
    pub hreflang_out: HashMap<String, HashSet<String>>,
}

/// Build the duplicate title/description/H1 and duplicate-URL-variant sets
/// across all crawled pages (titles/descs/H1s from 200 pages only).
pub fn cross_page(pages: &[Page]) -> CrossPage {
    let mut titles: HashMap<&str, usize> = HashMap::new();
    let mut descs: HashMap<&str, usize> = HashMap::new();
    let mut h1s: HashMap<&str, usize> = HashMap::new();
    let mut case: HashMap<String, HashSet<&str>> = HashMap::new();
    let mut slash: HashMap<&str, HashSet<&str>> = HashMap::new();
    for p in pages {
        case.entry(p.url.to_ascii_lowercase())
            .or_default()
            .insert(p.url.as_str());
        let key = p.url.trim_end_matches('/');
        if !key.is_empty() {
            slash.entry(key).or_default().insert(p.url.as_str());
        }
        if p.status != 200 {
            continue;
        }
        if let Some(t) = p.title.as_deref().filter(|s| !s.is_empty()) {
            *titles.entry(t).or_insert(0) += 1;
        }
        if let Some(d) = p.meta_description.as_deref().filter(|s| !s.is_empty()) {
            *descs.entry(d).or_insert(0) += 1;
        }
        if let Some(h) = p.h1.first().map(String::as_str).filter(|s| !s.is_empty()) {
            *h1s.entry(h).or_insert(0) += 1;
        }
    }
    let dups = |m: HashMap<&str, usize>| -> HashSet<String> {
        m.iter()
            .filter(|(_, &c)| c > 1)
            .map(|(&k, _)| k.to_string())
            .collect()
    };
    // Near-duplicate grouping over fingerprinted 200 pages (exact duplicates
    // are excluded — they're already flagged by `duplicate-content`).
    let candidates: Vec<(String, u64)> = pages
        .iter()
        .filter(|p| p.status == 200 && p.duplicate_of.is_none())
        .filter_map(|p| {
            let h = u64::from_str_radix(p.simhash.as_deref()?, 16).ok()?;
            Some((p.url.clone(), h))
        })
        .collect();
    let near_dup = crate::dedup::near_duplicates(&candidates);
    let mut hreflang_out: HashMap<String, HashSet<String>> = HashMap::new();
    for p in pages.iter().filter(|p| p.status == 200) {
        let hrefs: HashSet<String> = p.hreflang.iter().map(|h| norm(&h.href)).collect();
        hreflang_out.insert(norm(&p.url), hrefs.clone());
        hreflang_out.insert(norm(&p.final_url), hrefs);
    }
    CrossPage {
        dup_title: dups(titles),
        dup_desc: dups(descs),
        dup_h1: dups(h1s),
        dup_case: case
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(k, _)| k)
            .collect(),
        dup_slash: slash
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(k, _)| k.to_string())
            .collect(),
        in_sitemap: None,
        near_dup,
        hreflang_out,
    }
}

/// Whether an hreflang code is a plausible language(-script)(-region) tag,
/// e.g. `en`, `en-GB`, `zh-Hant`, `es-419`, or the special `x-default`.
fn valid_hreflang_code(code: &str) -> bool {
    if code.eq_ignore_ascii_case("x-default") {
        return true;
    }
    let mut parts = code.split('-');
    let lang = parts.next().unwrap_or("");
    if !(lang.len() == 2 || lang.len() == 3) || !lang.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    parts.all(|part| {
        ((part.len() == 2 || part.len() == 4) && part.chars().all(|c| c.is_ascii_alphabetic()))
            || (part.len() == 3 && part.chars().all(|c| c.is_ascii_digit()))
    })
}

/// Run every audit rule over the crawled pages.
pub fn audit(
    pages: &[Page],
    status_map: &HashMap<String, u16>,
    robots_blocked: &[String],
    seed: &Url,
) -> Vec<Issue> {
    audit_with_sitemap(pages, status_map, robots_blocked, seed, None)
}

/// [`audit`] with the sitemap URL set, enabling the sitemap↔crawl cross-check
/// rules (broken/noindex/redirecting URLs in the sitemap, indexable pages
/// missing from it).
pub fn audit_with_sitemap(
    pages: &[Page],
    status_map: &HashMap<String, u16>,
    robots_blocked: &[String],
    _seed: &Url,
    in_sitemap: Option<HashSet<String>>,
) -> Vec<Issue> {
    let mut out = Vec::new();
    let mut cp = cross_page(pages);
    cp.in_sitemap = in_sitemap;
    for p in pages {
        audit_one(p, &cp, status_map, &mut out);
    }
    // --- Blocked by robots.txt (from crawl-time discovery) ---
    for blocked in robots_blocked {
        out.push(issue(
            "blocked-by-robots",
            "Blocked by robots.txt",
            Category::Indexability,
            Severity::Warning,
            blocked,
            None,
        ));
    }
    out
}

/// Apply every per-page audit rule to one page. Shared by the in-memory
/// [`audit`] and the streaming crawl, which calls it on pages streamed back from
/// disk — so the rule logic lives in exactly one place.
pub fn audit_one(
    p: &Page,
    cp: &CrossPage,
    status_map: &HashMap<String, u16>,
    out: &mut Vec<Issue>,
) {
    use Category::*;
    use Severity::*;
    {
        let u = p.url.as_str();
        let is_html = p
            .content_type
            .as_deref()
            .map(|c| c.contains("html"))
            .unwrap_or(false)
            || !p.h1.is_empty()
            || p.word_count > 0;

        // --- Response codes ---
        if p.status == 0 {
            // A "too many redirects" client error is a redirect loop, not a
            // network fault — report it as the more actionable rule.
            let redirect_err = p
                .error
                .as_deref()
                .map(|e| e.to_ascii_lowercase().contains("redirect"))
                .unwrap_or(false);
            if redirect_err {
                out.push(issue(
                    "redirect-loop",
                    "Redirect Loop",
                    Response,
                    Error,
                    u,
                    p.error.clone(),
                ));
            } else {
                out.push(issue(
                    "connection-error",
                    "Connection Error",
                    Response,
                    Error,
                    u,
                    p.error.clone(),
                ));
            }
            return;
        } else if p.status >= 500 {
            out.push(issue(
                "server-error",
                "Server Error (5xx)",
                Response,
                Error,
                u,
                Some(p.status.to_string()),
            ));
        } else if p.status >= 400 {
            out.push(issue(
                "client-error",
                "Client Error (4xx)",
                Response,
                Error,
                u,
                Some(p.status.to_string()),
            ));
        } else if p.status >= 300 {
            out.push(issue(
                "redirect",
                "Redirect (3xx)",
                Response,
                Warning,
                u,
                Some(p.status.to_string()),
            ));
        }
        if p.redirect_chain.len() > 1 {
            out.push(issue(
                "redirect-chain",
                "Redirect Chain",
                Response,
                Warning,
                u,
                Some(format!("{} hops", p.redirect_chain.len())),
            ));
        }
        // A redirect that revisits a URL already in the chain never resolves.
        {
            let froms: HashSet<String> = p.redirect_chain.iter().map(|r| norm(&r.from)).collect();
            let revisits = froms.len() < p.redirect_chain.len()
                || p.redirect_chain
                    .last()
                    .map(|l| froms.contains(&norm(&l.to)))
                    .unwrap_or(false);
            if revisits {
                out.push(issue(
                    "redirect-loop",
                    "Redirect Loop",
                    Response,
                    Error,
                    u,
                    Some(format!("{} hops", p.redirect_chain.len())),
                ));
            }
        }
        if p.status == 302 || p.status == 307 {
            out.push(issue(
                "redirect-temporary",
                "Temporary Redirect",
                Response,
                Notice,
                u,
                Some(p.status.to_string()),
            ));
        }

        // --- Sitemap ↔ crawl cross-checks (when a sitemap URL set exists) ---
        if let Some(sm) = &cp.in_sitemap {
            let noindex = p
                .meta_robots
                .as_deref()
                .map(|r| r.contains("noindex"))
                .unwrap_or(false)
                || p.x_robots_tag
                    .as_deref()
                    .map(|r| r.to_ascii_lowercase().contains("noindex"))
                    .unwrap_or(false);
            if sm.contains(&norm(u)) || sm.contains(&norm(&p.final_url)) {
                if p.status >= 400 {
                    out.push(issue(
                        "sitemap-broken",
                        "Broken URL in Sitemap",
                        Indexability,
                        Error,
                        u,
                        Some(p.status.to_string()),
                    ));
                } else if p.status >= 300 {
                    out.push(issue(
                        "sitemap-redirect",
                        "Redirecting URL in Sitemap",
                        Indexability,
                        Warning,
                        u,
                        Some(p.status.to_string()),
                    ));
                } else if noindex {
                    out.push(issue(
                        "sitemap-noindex",
                        "Noindex URL in Sitemap",
                        Indexability,
                        Error,
                        u,
                        None,
                    ));
                } else if p.canonicalized {
                    out.push(issue(
                        "sitemap-canonicalized",
                        "Canonicalised URL in Sitemap",
                        Indexability,
                        Warning,
                        u,
                        p.canonical.clone(),
                    ));
                }
            } else if p.status == 200 && p.indexable && is_html {
                out.push(issue(
                    "not-in-sitemap",
                    "Indexable Page Not in Sitemap",
                    Indexability,
                    Notice,
                    u,
                    None,
                ));
            }
        }
        if p.status == 200 && p.response_time_ms > SLOW_MS {
            out.push(issue(
                "slow-response",
                "Slow Response",
                Response,
                Notice,
                u,
                Some(format!("{} ms", p.response_time_ms)),
            ));
        }

        // --- Broken outbound links ---
        // Only count genuine breakage: connection failure, 404/410, or 5xx.
        // 401/403/405/429 usually mean bot-blocking or rate-limiting on a HEAD
        // probe, not a dead link, so we don't flag those as broken.
        for link in p.internal_links.iter().chain(p.external_links.iter()) {
            if let Some(&s) = status_map.get(&norm(link)) {
                if s == 0 || s == 404 || s == 410 || s >= 500 {
                    out.push(issue(
                        "broken-link",
                        "Broken Link",
                        Links,
                        Error,
                        u,
                        Some(format!(
                            "{} → {}",
                            if s == 0 { "ERR".into() } else { s.to_string() },
                            link
                        )),
                    ));
                }
            }
        }

        if p.status != 200 {
            return;
        }

        // --- URL hygiene (applies to every 200 URL, HTML or asset) ---
        if let Ok(parsed) = url::Url::parse(u) {
            let path = parsed.path();
            if path.chars().any(|c| c.is_ascii_uppercase()) {
                out.push(issue(
                    "url-uppercase",
                    "Uppercase Characters in URL",
                    Category::Url,
                    Notice,
                    u,
                    None,
                ));
            }
            if path.contains('_') {
                out.push(issue(
                    "url-underscores",
                    "Underscores in URL",
                    Category::Url,
                    Notice,
                    u,
                    None,
                ));
            }
            if path.contains(' ') || path.contains("%20") {
                out.push(issue(
                    "url-space",
                    "Whitespace in URL",
                    Category::Url,
                    Warning,
                    u,
                    None,
                ));
            }
            if path.contains("//") {
                out.push(issue(
                    "url-double-slash",
                    "Multiple Slashes in URL",
                    Category::Url,
                    Warning,
                    u,
                    None,
                ));
            }
            if !u.is_ascii() {
                out.push(issue(
                    "url-non-ascii",
                    "Non-ASCII Characters in URL",
                    Category::Url,
                    Notice,
                    u,
                    None,
                ));
            }
            let len = u.chars().count();
            if len > URL_MAX {
                out.push(issue(
                    "url-too-long",
                    "URL Over 115 Characters",
                    Category::Url,
                    Notice,
                    u,
                    Some(format!("{len} chars")),
                ));
            }
            let params = parsed.query_pairs().count();
            if params > 1 {
                out.push(issue(
                    "url-parameters",
                    "Multiple URL Parameters",
                    Category::Url,
                    Notice,
                    u,
                    Some(format!("{params} parameters")),
                ));
            }
            if parsed.query_pairs().any(|(k, _)| {
                let k = k.to_ascii_lowercase();
                k.starts_with("utm_") || k == "gclid" || k == "fbclid" || k == "msclkid"
            }) {
                out.push(issue(
                    "url-tracking-params",
                    "Tracking Parameters in URL",
                    Category::Url,
                    Notice,
                    u,
                    None,
                ));
            }
            // Internal search-result URLs — infinite spaces that shouldn't be
            // crawled or indexed.
            if parsed.query_pairs().any(|(k, v)| {
                let k = k.to_ascii_lowercase();
                (k == "s" || k == "q" || k == "query" || k == "search" || k == "keyword")
                    && !v.is_empty()
            }) {
                out.push(issue(
                    "url-internal-search",
                    "Internal Search URL Crawled",
                    Category::Url,
                    Notice,
                    u,
                    None,
                ));
            }
            // A path segment repeating 3+ times is usually a relative-link
            // crawl trap (/page/page/page/…).
            {
                let mut counts: HashMap<&str, usize> = HashMap::new();
                for seg in path.split('/').filter(|s| !s.is_empty()) {
                    *counts.entry(seg).or_insert(0) += 1;
                }
                if let Some((seg, &c)) = counts.iter().max_by_key(|(_, &c)| c) {
                    if c >= 3 {
                        out.push(issue(
                            "url-repetitive-path",
                            "Repetitive Path Segments",
                            Category::Url,
                            Warning,
                            u,
                            Some(format!("\"{seg}\" appears {c} times")),
                        ));
                    }
                }
            }
        }
        if cp.dup_case.contains(&u.to_ascii_lowercase()) {
            out.push(issue(
                "url-case-duplicate",
                "Duplicate URL (Case Variant)",
                Category::Url,
                Warning,
                u,
                None,
            ));
        }
        {
            let key = u.trim_end_matches('/');
            if !key.is_empty() && cp.dup_slash.contains(key) {
                out.push(issue(
                    "url-slash-duplicate",
                    "Duplicate URL (Trailing Slash)",
                    Category::Url,
                    Warning,
                    u,
                    None,
                ));
            }
        }

        // On-page SEO rules only apply to HTML documents — never to assets
        // (svg/css/js/json/pdf…) that slipped into the link graph.
        if !is_html {
            return;
        }

        // --- Response vs render (render mode only) ---
        if let Some(d) = &p.render_diff {
            if d.noindex_raw_only {
                out.push(issue(
                    "render-noindex-raw-only",
                    "Noindex in Raw HTML Only",
                    Indexability,
                    Error,
                    u,
                    Some("Google honours the raw noindex and never renders the page".into()),
                ));
            }
            if d.noindex_rendered_only {
                out.push(issue(
                    "render-noindex-js",
                    "Noindex Injected by JavaScript",
                    Indexability,
                    Warning,
                    u,
                    None,
                ));
            }
            if d.canonical_mismatch {
                out.push(issue(
                    "render-canonical-mismatch",
                    "Canonical Changed by JavaScript",
                    Canonical,
                    Error,
                    u,
                    None,
                ));
            }
            if d.canonical_rendered_only {
                out.push(issue(
                    "render-canonical-js",
                    "Canonical Only in Rendered DOM",
                    Canonical,
                    Warning,
                    u,
                    None,
                ));
            }
            if d.title_rendered_only {
                out.push(issue(
                    "render-title-js",
                    "Title Only in Rendered DOM",
                    TitlesMeta,
                    Warning,
                    u,
                    None,
                ));
            } else if d.title_modified {
                out.push(issue(
                    "render-title-modified",
                    "Title Modified by JavaScript",
                    TitlesMeta,
                    Notice,
                    u,
                    None,
                ));
            }
            if d.description_rendered_only {
                out.push(issue(
                    "render-description-js",
                    "Meta Description Only in Rendered DOM",
                    TitlesMeta,
                    Notice,
                    u,
                    None,
                ));
            } else if d.description_modified {
                out.push(issue(
                    "render-description-modified",
                    "Meta Description Modified by JavaScript",
                    TitlesMeta,
                    Notice,
                    u,
                    None,
                ));
            }
            if d.h1_rendered_only {
                out.push(issue(
                    "render-h1-js",
                    "H1 Only in Rendered DOM",
                    Headings,
                    Notice,
                    u,
                    None,
                ));
            } else if d.h1_modified {
                out.push(issue(
                    "render-h1-modified",
                    "H1 Modified by JavaScript",
                    Headings,
                    Notice,
                    u,
                    None,
                ));
            }
            if d.js_only_links > 0 {
                out.push(issue(
                    "render-js-only-links",
                    "JavaScript-Only Internal Links",
                    Links,
                    Warning,
                    u,
                    Some(format!(
                        "{} internal link(s) exist only after JavaScript runs",
                        d.js_only_links
                    )),
                ));
            }
        }

        // --- Head & markup validation ---
        let m = &p.markup;
        if m.title_count > 1 {
            out.push(issue(
                "title-multiple",
                "Multiple Title Tags",
                TitlesMeta,
                Warning,
                u,
                Some(format!("{} <title> tags", m.title_count)),
            ));
        }
        if m.meta_description_count > 1 {
            out.push(issue(
                "description-multiple",
                "Multiple Meta Descriptions",
                TitlesMeta,
                Notice,
                u,
                Some(format!("{} description tags", m.meta_description_count)),
            ));
        }
        if m.canonical_conflict {
            out.push(issue(
                "canonical-conflict",
                "Conflicting Canonical Tags",
                Canonical,
                Error,
                u,
                Some(format!(
                    "{} canonicals pointing to different URLs",
                    m.canonical_count
                )),
            ));
        } else if m.canonical_count > 1 {
            out.push(issue(
                "canonical-multiple",
                "Multiple Canonical Tags",
                Canonical,
                Notice,
                u,
                Some(format!("{} canonical tags", m.canonical_count)),
            ));
        }
        if m.viewport_count > 1 {
            out.push(issue(
                "viewport-multiple",
                "Multiple Viewport Tags",
                Mobile,
                Notice,
                u,
                Some(format!("{} viewport tags", m.viewport_count)),
            ));
        }
        if let Some(refresh) = &m.meta_refresh {
            out.push(issue(
                "meta-refresh",
                "Meta Refresh Redirect",
                Response,
                Warning,
                u,
                Some(refresh.clone()),
            ));
        }
        if !m.has_charset {
            out.push(issue(
                "charset-missing",
                "Missing Character Encoding",
                Content,
                Notice,
                u,
                None,
            ));
        }
        if !m.has_favicon {
            out.push(issue(
                "favicon-missing",
                "Missing Favicon",
                Social,
                Notice,
                u,
                None,
            ));
        }
        if m.soft404_phrase {
            out.push(issue(
                "soft-404",
                "Possible Soft 404",
                Content,
                Warning,
                u,
                Some("Error-page phrasing on a 200 response".into()),
            ));
        }
        if m.lorem_ipsum {
            out.push(issue(
                "lorem-ipsum",
                "Placeholder Text (Lorem Ipsum)",
                Content,
                Warning,
                u,
                None,
            ));
        }
        if m.imgs_no_dimensions > 0 {
            out.push(issue(
                "image-no-dimensions",
                "Images Missing Dimensions",
                Performance,
                Notice,
                u,
                Some(format!(
                    "{} of {} images without width/height",
                    m.imgs_no_dimensions, p.images_total
                )),
            ));
        }
        if m.nofollow_links > 0 {
            out.push(issue(
                "nofollow-internal-links",
                "Nofollow Internal Links",
                Links,
                Notice,
                u,
                Some(format!("{} internal link(s)", m.nofollow_links)),
            ));
        }
        if m.generic_anchors > 0 {
            out.push(issue(
                "generic-anchor-text",
                "Non-Descriptive Anchor Text",
                Links,
                Notice,
                u,
                Some(format!("{} link(s)", m.generic_anchors)),
            ));
        }
        // AMP alternate that resolves to an error.
        if let Some(amp) = &m.amp_url {
            if let Some(&s) = status_map.get(&norm(amp)) {
                if s == 0 || s >= 400 {
                    out.push(issue(
                        "amp-broken",
                        "Broken AMP URL",
                        Indexability,
                        Warning,
                        u,
                        Some(format!(
                            "{} → {amp}",
                            if s == 0 { "ERR".into() } else { s.to_string() }
                        )),
                    ));
                } else if (300..400).contains(&s) {
                    out.push(issue(
                        "amp-redirect",
                        "Redirecting AMP URL",
                        Indexability,
                        Notice,
                        u,
                        Some(format!("{s} → {amp}")),
                    ));
                }
            }
        }
        // Pagination targets that resolve to an error.
        for (rel, target) in [("prev", &m.rel_prev), ("next", &m.rel_next)] {
            if let Some(t) = target {
                if let Some(&s) = status_map.get(&norm(t)) {
                    if s == 0 || s == 404 || s == 410 || s >= 500 {
                        out.push(issue(
                            "pagination-broken",
                            "Broken Pagination URL",
                            Links,
                            Warning,
                            u,
                            Some(format!(
                                "rel={rel}: {} → {t}",
                                if s == 0 { "ERR".into() } else { s.to_string() }
                            )),
                        ));
                    }
                }
            }
        }

        // --- Titles & meta ---
        match p.title.as_deref() {
            None | Some("") => out.push(issue(
                "title-missing",
                "Missing Title",
                TitlesMeta,
                Error,
                u,
                None,
            )),
            Some(t) => {
                let len = t.chars().count();
                if len > TITLE_MAX {
                    out.push(issue(
                        "title-too-long",
                        "Title Too Long",
                        TitlesMeta,
                        Warning,
                        u,
                        Some(format!("{len} chars")),
                    ));
                } else if len < TITLE_MIN {
                    out.push(issue(
                        "title-too-short",
                        "Title Too Short",
                        TitlesMeta,
                        Notice,
                        u,
                        Some(format!("{len} chars")),
                    ));
                }
                if cp.dup_title.contains(t) {
                    out.push(issue(
                        "title-duplicate",
                        "Duplicate Title",
                        TitlesMeta,
                        Warning,
                        u,
                        None,
                    ));
                }
            }
        }
        match p.meta_description.as_deref() {
            None | Some("") => out.push(issue(
                "description-missing",
                "Missing Meta Description",
                TitlesMeta,
                Warning,
                u,
                None,
            )),
            Some(d) => {
                let len = d.chars().count();
                if len > DESC_MAX {
                    out.push(issue(
                        "description-too-long",
                        "Meta Description Too Long",
                        TitlesMeta,
                        Notice,
                        u,
                        Some(format!("{len} chars")),
                    ));
                } else if len < DESC_MIN {
                    out.push(issue(
                        "description-too-short",
                        "Meta Description Too Short",
                        TitlesMeta,
                        Notice,
                        u,
                        Some(format!("{len} chars")),
                    ));
                }
                if cp.dup_desc.contains(d) {
                    out.push(issue(
                        "description-duplicate",
                        "Duplicate Meta Description",
                        TitlesMeta,
                        Warning,
                        u,
                        None,
                    ));
                }
            }
        }

        // --- Headings ---
        if p.h1.is_empty() {
            out.push(issue(
                "h1-missing",
                "Missing H1",
                Headings,
                Warning,
                u,
                None,
            ));
        } else if p.h1.len() > 1 {
            out.push(issue(
                "h1-multiple",
                "Multiple H1",
                Headings,
                Notice,
                u,
                Some(format!("{} H1s", p.h1.len())),
            ));
        }
        if let Some(h) = p.h1.first() {
            let len = h.chars().count();
            if len > H1_MAX {
                out.push(issue(
                    "h1-too-long",
                    "H1 Too Long",
                    Headings,
                    Notice,
                    u,
                    Some(format!("{len} chars")),
                ));
            }
            if !h.is_empty() && cp.dup_h1.contains(h) {
                out.push(issue(
                    "h1-duplicate",
                    "Duplicate H1",
                    Headings,
                    Notice,
                    u,
                    None,
                ));
            }
        }
        if p.word_count > H2_MIN_WORDS && p.h2_count == 0 {
            out.push(issue(
                "h2-missing",
                "No H2 Headings",
                Headings,
                Notice,
                u,
                Some(format!("{} words without an H2", p.word_count)),
            ));
        }

        // --- Indexability ---
        let meta_noindex = p
            .meta_robots
            .as_deref()
            .map(|r| r.contains("noindex"))
            .unwrap_or(false);
        if meta_noindex {
            out.push(issue("noindex", "Noindex", Indexability, Warning, u, None));
        }
        if p.meta_robots
            .as_deref()
            .map(|r| r.contains("nofollow"))
            .unwrap_or(false)
        {
            out.push(issue("nofollow", "Nofollow", Indexability, Notice, u, None));
        }
        // Less-common robots directives worth surfacing (the string is already
        // lowercased at parse time).
        if let Some(robots) = p.meta_robots.as_deref() {
            let has = |token: &str| robots.split(',').any(|t| t.trim() == token);
            if has("none") {
                out.push(issue(
                    "robots-none",
                    "Robots Directive: none",
                    Indexability,
                    Warning,
                    u,
                    Some("\"none\" = noindex, nofollow".into()),
                ));
            }
            if has("nosnippet") {
                out.push(issue(
                    "robots-nosnippet",
                    "Robots Directive: nosnippet",
                    Indexability,
                    Notice,
                    u,
                    None,
                ));
            }
            if has("noarchive") {
                out.push(issue(
                    "robots-noarchive",
                    "Robots Directive: noarchive",
                    Indexability,
                    Notice,
                    u,
                    None,
                ));
            }
            if has("noimageindex") {
                out.push(issue(
                    "robots-noimageindex",
                    "Robots Directive: noimageindex",
                    Indexability,
                    Notice,
                    u,
                    None,
                ));
            }
            if robots.contains("unavailable_after") {
                out.push(issue(
                    "robots-unavailable-after",
                    "Robots Directive: unavailable_after",
                    Indexability,
                    Warning,
                    u,
                    Some(robots.to_string()),
                ));
            }
        }
        if !meta_noindex
            && p.x_robots_tag
                .as_deref()
                .map(|r| r.to_ascii_lowercase().contains("noindex"))
                .unwrap_or(false)
        {
            out.push(issue(
                "x-robots-noindex",
                "X-Robots-Tag: noindex",
                Indexability,
                Warning,
                u,
                p.x_robots_tag.clone(),
            ));
        }

        // --- Canonicals ---
        if p.canonical.is_none() {
            out.push(issue(
                "canonical-missing",
                "Missing Canonical",
                Canonical,
                Notice,
                u,
                None,
            ));
        } else if p.canonicalized {
            out.push(issue(
                "canonicalised",
                "Canonicalised",
                Canonical,
                Notice,
                u,
                p.canonical.clone(),
            ));
        }
        if let Some(canon) = p.canonical.as_deref() {
            // The canonical target's health, when we know it (crawled or
            // HEAD-verified). A canonical pointing at a broken or redirecting
            // URL sends indexing signals into a dead end.
            if let Some(&s) = status_map.get(&norm(canon)) {
                if s == 0 || s == 404 || s == 410 || s >= 500 {
                    out.push(issue(
                        "canonical-to-broken",
                        "Canonical Points to Broken URL",
                        Canonical,
                        Error,
                        u,
                        Some(format!(
                            "{} → {}",
                            if s == 0 { "ERR".into() } else { s.to_string() },
                            canon
                        )),
                    ));
                } else if (300..400).contains(&s) {
                    out.push(issue(
                        "canonical-to-redirect",
                        "Canonical Points to Redirect",
                        Canonical,
                        Warning,
                        u,
                        Some(format!("{s} → {canon}")),
                    ));
                }
            }
            if let (Ok(cu), Ok(pu)) = (url::Url::parse(canon), url::Url::parse(u)) {
                if let (Some(ch), Some(ph)) = (cu.host_str(), pu.host_str()) {
                    if !ch.eq_ignore_ascii_case(ph) {
                        out.push(issue(
                            "canonical-cross-host",
                            "Canonical Points to Another Host",
                            Canonical,
                            Notice,
                            u,
                            Some(canon.to_string()),
                        ));
                    }
                }
            }
            if meta_noindex && p.canonicalized {
                out.push(issue(
                    "noindex-canonical-conflict",
                    "Noindex Combined With Canonical",
                    Indexability,
                    Warning,
                    u,
                    Some(canon.to_string()),
                ));
            }
        }

        // --- Images ---
        if p.images_missing_alt > 0 {
            out.push(issue(
                "image-missing-alt",
                "Images Missing Alt Text",
                Images,
                Warning,
                u,
                Some(format!(
                    "{} of {} images",
                    p.images_missing_alt, p.images_total
                )),
            ));
        }

        // --- Content ---
        if p.word_count < THIN_WORDS {
            out.push(issue(
                "thin-content",
                "Thin Content",
                Content,
                Notice,
                u,
                Some(format!("{} words", p.word_count)),
            ));
        }
        // Content that only exists after JavaScript renders. Only detectable in
        // render mode (`pre_render_word_count` = raw HTML, `word_count` = post-JS
        // DOM): real content after render, but the raw payload a non-JS crawler
        // sees is largely empty.
        if p.rendered
            && p.status == 200
            && p.word_count >= JS_CONTENT_MIN
            && p.pre_render_word_count * 3 < p.word_count
        {
            let pct = (p.pre_render_word_count * 100) / p.word_count.max(1);
            out.push(issue(
                "content-requires-js",
                "Content Requires JavaScript",
                Indexability,
                Warning,
                u,
                Some(format!(
                    "Only {pct}% of content ({} of {} words) is in the raw HTML; the rest needs JavaScript",
                    p.pre_render_word_count, p.word_count
                )),
            ));
        }
        if p.size_bytes > LARGE_BYTES {
            out.push(issue(
                "large-page",
                "Large Page Size",
                Performance,
                Notice,
                u,
                Some(format!("{} KB", p.size_bytes / 1024)),
            ));
        }
        if let Some(canon) = &p.duplicate_of {
            out.push(issue(
                "duplicate-content",
                "Duplicate Content",
                Content,
                Warning,
                u,
                Some(format!("Duplicate of {canon}")),
            ));
        } else if let Some((canon, pct)) = cp.near_dup.get(u) {
            if canon != u {
                out.push(issue(
                    "near-duplicate",
                    "Near-Duplicate Content",
                    Content,
                    Warning,
                    u,
                    Some(format!("≈{pct}% similar to {canon}")),
                ));
            }
        }
        // Readability (English-language pages with enough text; the Flesch
        // formula is English-calibrated so other languages are skipped).
        if p.lang
            .as_deref()
            .map(|l| l.to_ascii_lowercase().starts_with("en"))
            .unwrap_or(false)
        {
            if let Some(f) = p.readability {
                if f < 30.0 {
                    out.push(issue(
                        "readability-very-difficult",
                        "Very Difficult to Read",
                        Content,
                        Notice,
                        u,
                        Some(format!("Flesch score {f:.0}")),
                    ));
                } else if f < 50.0 {
                    out.push(issue(
                        "readability-difficult",
                        "Difficult to Read",
                        Content,
                        Notice,
                        u,
                        Some(format!("Flesch score {f:.0}")),
                    ));
                }
            }
        }
        if p.text_ratio > 0.0 && p.text_ratio < 0.08 && p.word_count < THIN_WORDS {
            out.push(issue(
                "low-text-ratio",
                "Low Text-to-HTML Ratio",
                Content,
                Notice,
                u,
                Some(format!("{:.0}%", p.text_ratio * 100.0)),
            ));
        }

        // --- Structure ---
        if p.inlinks == 0 && p.depth > 0 {
            out.push(issue(
                "orphan",
                "Orphan Page",
                Links,
                Notice,
                u,
                Some("No internal inlinks".into()),
            ));
        }
        if p.status == 200 && p.indexable && is_html && p.internal_links.is_empty() {
            out.push(issue(
                "dead-end",
                "Dead End",
                Links,
                Notice,
                u,
                Some("No internal outlinks".into()),
            ));
        }
        if p.depth > DEEP {
            out.push(issue(
                "deep-page",
                "Deep Page",
                Links,
                Notice,
                u,
                Some(format!("{} clicks from home", p.depth)),
            ));
        }
        let outlinks = p.internal_links.len() + p.external_links.len();
        if outlinks > MAX_OUTLINKS {
            out.push(issue(
                "too-many-links",
                "Excessive Outlinks",
                Links,
                Notice,
                u,
                Some(format!("{outlinks} outgoing links")),
            ));
        }

        // --- Performance ---
        if is_html && p.content_encoding.is_none() && p.size_bytes > 4096 {
            out.push(issue(
                "no-compression",
                "No Text Compression",
                Performance,
                Notice,
                u,
                None,
            ));
        }

        // --- Security ---
        if p.final_url.starts_with("http://") {
            out.push(issue(
                "not-secure",
                "Not Served Over HTTPS",
                Security,
                Warning,
                u,
                None,
            ));
        } else {
            if p.mixed_content > 0 {
                out.push(issue(
                    "mixed-content",
                    "Mixed Content",
                    Security,
                    Warning,
                    u,
                    Some(format!("{} insecure resources", p.mixed_content)),
                ));
            }
            if !p.hsts {
                out.push(issue(
                    "no-hsts",
                    "No HSTS Header",
                    Security,
                    Notice,
                    u,
                    None,
                ));
            }
            // Hyperlinks (not resources — that's mixed-content) pointing at
            // plain-HTTP URLs from a secure page.
            let http_links = p
                .internal_links
                .iter()
                .chain(p.external_links.iter())
                .filter(|l| l.starts_with("http://"))
                .count();
            if http_links > 0 {
                out.push(issue(
                    "https-to-http-link",
                    "HTTPS Page Links to HTTP",
                    Security,
                    Warning,
                    u,
                    Some(format!("{http_links} link(s) to HTTP URLs")),
                ));
            }
            if p.markup.form_to_http {
                out.push(issue(
                    "form-to-http",
                    "Form Posts to Insecure URL",
                    Security,
                    Warning,
                    u,
                    None,
                ));
            }
        }
        if p.markup.protocol_relative > 0 {
            out.push(issue(
                "protocol-relative-links",
                "Protocol-Relative Resource Links",
                Security,
                Notice,
                u,
                Some(format!("{} resource(s)", p.markup.protocol_relative)),
            ));
        }
        // Recommended security response headers.
        let sh = &p.sec_headers;
        if !sh.csp {
            out.push(issue(
                "no-csp",
                "Missing Content-Security-Policy",
                Security,
                Notice,
                u,
                None,
            ));
        }
        if !sh.x_content_type_options {
            out.push(issue(
                "no-content-type-options",
                "Missing X-Content-Type-Options",
                Security,
                Notice,
                u,
                None,
            ));
        }
        if !sh.x_frame_options {
            out.push(issue(
                "no-frame-options",
                "Missing X-Frame-Options",
                Security,
                Notice,
                u,
                None,
            ));
        }
        if !sh.referrer_policy {
            out.push(issue(
                "no-referrer-policy",
                "Missing Referrer-Policy",
                Security,
                Notice,
                u,
                None,
            ));
        }

        // --- Mobile ---
        if !p.has_viewport {
            out.push(issue(
                "viewport-missing",
                "Missing Viewport",
                Mobile,
                Warning,
                u,
                None,
            ));
        }

        // --- International ---
        if p.lang.is_none() {
            out.push(issue(
                "lang-missing",
                "Missing Lang Attribute",
                International,
                Notice,
                u,
                None,
            ));
        }
        if !p.hreflang.is_empty() {
            // Invalid language/region codes make the whole annotation set
            // unusable to search engines.
            let bad: Vec<&str> = p
                .hreflang
                .iter()
                .filter(|h| !valid_hreflang_code(&h.lang))
                .map(|h| h.lang.as_str())
                .collect();
            if !bad.is_empty() {
                out.push(issue(
                    "hreflang-invalid-code",
                    "Invalid hreflang Code",
                    International,
                    Warning,
                    u,
                    Some(bad.join(", ")),
                ));
            }
            // hreflang alternates that resolve to an error, when we know the
            // target's status.
            for h in &p.hreflang {
                if let Some(&s) = status_map.get(&norm(&h.href)) {
                    if s == 0 || s == 404 || s == 410 || s >= 500 {
                        out.push(issue(
                            "hreflang-broken",
                            "hreflang Points to Broken URL",
                            International,
                            Warning,
                            u,
                            Some(format!(
                                "{} → {} ({})",
                                h.lang,
                                h.href,
                                if s == 0 { "ERR".into() } else { s.to_string() }
                            )),
                        ));
                    }
                }
            }
            if !p
                .hreflang
                .iter()
                .any(|h| h.lang.eq_ignore_ascii_case("x-default"))
            {
                out.push(issue(
                    "hreflang-no-x-default",
                    "hreflang Missing x-default",
                    International,
                    Notice,
                    u,
                    None,
                ));
            }
            // Reciprocity: every crawled alternate must link back, or the
            // whole cluster is ignored by search engines.
            let self_keys = [norm(u), norm(&p.final_url)];
            for h in &p.hreflang {
                let target = norm(&h.href);
                if self_keys.contains(&target) {
                    continue;
                }
                if let Some(back) = cp.hreflang_out.get(&target) {
                    if !self_keys.iter().any(|k| back.contains(k)) {
                        out.push(issue(
                            "hreflang-no-return",
                            "hreflang Missing Return Link",
                            International,
                            Warning,
                            u,
                            Some(format!("{} does not link back", h.href)),
                        ));
                    }
                }
            }
            let has_self = p
                .lang
                .as_deref()
                .map(|l| {
                    p.hreflang.iter().any(|h| {
                        h.lang.eq_ignore_ascii_case("x-default")
                            || h.lang
                                .to_ascii_lowercase()
                                .starts_with(&l.to_ascii_lowercase()[..l.len().min(2)])
                    })
                })
                .unwrap_or(false);
            if !has_self {
                out.push(issue(
                    "hreflang-incomplete",
                    "Incomplete hreflang",
                    International,
                    Notice,
                    u,
                    None,
                ));
            }
        }

        // --- Accessibility (static WCAG checks) ---
        // Runs on every 200 HTML page, indexable or not — accessibility matters
        // regardless of whether the page is meant for search.
        let a = &p.a11y;
        if a.links_no_text > 0 {
            out.push(issue(
                "a11y-link-no-text",
                "Links Without Discernible Text",
                Accessibility,
                Warning,
                u,
                Some(format!("{} of {} links", a.links_no_text, a.links_total)),
            ));
        }
        if a.buttons_no_text > 0 {
            out.push(issue(
                "a11y-button-no-text",
                "Buttons Without an Accessible Name",
                Accessibility,
                Warning,
                u,
                Some(format!("{} button(s)", a.buttons_no_text)),
            ));
        }
        if a.inputs_no_label > 0 {
            out.push(issue(
                "a11y-input-no-label",
                "Form Controls Without a Label",
                Accessibility,
                Warning,
                u,
                Some(format!(
                    "{} of {} controls",
                    a.inputs_no_label, a.controls_total
                )),
            ));
        }
        if a.viewport_blocks_zoom {
            out.push(issue(
                "a11y-zoom-disabled",
                "Viewport Disables Zoom",
                Accessibility,
                Warning,
                u,
                None,
            ));
        }
        if a.iframes_no_title > 0 {
            out.push(issue(
                "a11y-iframe-no-title",
                "Iframes Missing a Title",
                Accessibility,
                Notice,
                u,
                Some(format!("{} iframe(s)", a.iframes_no_title)),
            ));
        }
        if a.positive_tabindex > 0 {
            out.push(issue(
                "a11y-positive-tabindex",
                "Positive tabindex",
                Accessibility,
                Notice,
                u,
                Some(format!("{} element(s)", a.positive_tabindex)),
            ));
        }
        if a.skipped_heading {
            out.push(issue(
                "a11y-skipped-heading",
                "Skipped Heading Level",
                Accessibility,
                Notice,
                u,
                None,
            ));
        }

        // Soft SEO/GEO rules only for indexable pages (no point on noindexed).
        if !p.indexable {
            return;
        }

        // --- Social ---
        if p.og_title.is_none() {
            out.push(issue(
                "og-missing",
                "Missing Open Graph Tags",
                Social,
                Notice,
                u,
                None,
            ));
        }
        if p.twitter_card.is_none() {
            out.push(issue(
                "twitter-missing",
                "Missing Twitter Card",
                Social,
                Notice,
                u,
                None,
            ));
        }
        if p.og_title.is_some() && p.og_image.is_none() {
            out.push(issue(
                "og-incomplete",
                "Open Graph Missing Image",
                Social,
                Notice,
                u,
                None,
            ));
        }

        // --- Structured data ---
        if p.schema_types.is_empty() {
            out.push(issue(
                "structured-data-missing",
                "No Structured Data",
                StructuredData,
                Notice,
                u,
                None,
            ));
        }
        // JSON-LD that doesn't parse is invisible to search engines.
        if p.invalid_jsonld > 0 {
            out.push(issue(
                "structured-data-invalid",
                "Invalid Structured Data",
                StructuredData,
                Error,
                u,
                Some(format!(
                    "{} JSON-LD block(s) failed to parse",
                    p.invalid_jsonld
                )),
            ));
        }
        // Per-item required/recommended property gaps (rich-result eligibility).
        for v in &p.schema_validations {
            if !v.missing_required.is_empty() {
                out.push(issue(
                    "schema-missing-required",
                    "Schema Missing Required Field",
                    StructuredData,
                    Warning,
                    u,
                    Some(format!(
                        "{}: missing {}",
                        v.type_name,
                        v.missing_required.join(", ")
                    )),
                ));
            }
            if !v.missing_recommended.is_empty() {
                out.push(issue(
                    "schema-missing-recommended",
                    "Schema Missing Recommended Field",
                    StructuredData,
                    Notice,
                    u,
                    Some(format!(
                        "{}: missing {}",
                        v.type_name,
                        v.missing_recommended.join(", ")
                    )),
                ));
            }
        }

        // --- GEO (Generative Engine Optimization) ---
        if p.word_count > 50 {
            if p.geo.score >= GEO_READY {
                out.push(issue(
                    "geo-ready",
                    "GEO: AI-Ready Page",
                    Geo,
                    Good,
                    u,
                    Some(format!("{}/100", p.geo.score)),
                ));
            } else {
                if !p.geo.structured_data {
                    out.push(issue(
                        "geo-no-structured-data",
                        "GEO: No Machine-Readable Structure",
                        Geo,
                        Warning,
                        u,
                        None,
                    ));
                }
                if !p.geo.answerable {
                    out.push(issue(
                        "geo-not-answerable",
                        "GEO: Not Answer-Ready",
                        Geo,
                        Notice,
                        u,
                        None,
                    ));
                }
                if !p.geo.has_author {
                    out.push(issue(
                        "geo-no-author",
                        "GEO: Missing Authorship / E-E-A-T",
                        Geo,
                        Notice,
                        u,
                        None,
                    ));
                }
                if !p.geo.semantic_html {
                    out.push(issue(
                        "geo-no-semantic-html",
                        "GEO: Weak Semantic Structure",
                        Geo,
                        Notice,
                        u,
                        None,
                    ));
                }
                if p.word_count < 300 {
                    out.push(issue(
                        "geo-thin-for-ai",
                        "GEO: Too Thin to Cite",
                        Geo,
                        Notice,
                        u,
                        Some(format!("{} words", p.word_count)),
                    ));
                }
            }
        }
    }
}
