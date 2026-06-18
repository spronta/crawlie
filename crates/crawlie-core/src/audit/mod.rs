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
const SLOW_MS: u64 = 2000;
const LARGE_BYTES: usize = 2_000_000;
const DEEP: usize = 4;
const GEO_READY: u8 = 70;

fn issue(rule: &str, title: &str, category: Category, severity: Severity, url: &str, detail: Option<String>) -> Issue {
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

/// Run every audit rule over the crawled pages.
pub fn audit(
    pages: &[Page],
    status_map: &HashMap<String, u16>,
    robots_blocked: &[String],
    _seed: &Url,
) -> Vec<Issue> {
    let mut out = Vec::new();
    use Category::*;
    use Severity::*;

    // Cross-page duplicate title/description detection (200-only).
    let mut titles: HashMap<&str, usize> = HashMap::new();
    let mut descs: HashMap<&str, usize> = HashMap::new();
    for p in pages.iter().filter(|p| p.status == 200) {
        if let Some(t) = p.title.as_deref().filter(|s| !s.is_empty()) {
            *titles.entry(t).or_insert(0) += 1;
        }
        if let Some(d) = p.meta_description.as_deref().filter(|s| !s.is_empty()) {
            *descs.entry(d).or_insert(0) += 1;
        }
    }
    let dup_title: HashSet<&str> = titles.iter().filter(|(_, &c)| c > 1).map(|(&k, _)| k).collect();
    let dup_desc: HashSet<&str> = descs.iter().filter(|(_, &c)| c > 1).map(|(&k, _)| k).collect();

    for p in pages {
        let u = p.url.as_str();
        let is_html = p.content_type.as_deref().map(|c| c.contains("html")).unwrap_or(false) || !p.h1.is_empty() || p.word_count > 0;

        // --- Response codes ---
        if p.status == 0 {
            out.push(issue("connection-error", "Connection Error", Response, Error, u, p.error.clone()));
            continue;
        } else if p.status >= 500 {
            out.push(issue("server-error", "Server Error (5xx)", Response, Error, u, Some(p.status.to_string())));
        } else if p.status >= 400 {
            out.push(issue("client-error", "Client Error (4xx)", Response, Error, u, Some(p.status.to_string())));
        } else if p.status >= 300 {
            out.push(issue("redirect", "Redirect (3xx)", Response, Warning, u, Some(p.status.to_string())));
        }
        if p.redirect_chain.len() > 1 {
            out.push(issue("redirect-chain", "Redirect Chain", Response, Warning, u, Some(format!("{} hops", p.redirect_chain.len()))));
        }
        if p.status == 200 && p.response_time_ms > SLOW_MS {
            out.push(issue("slow-response", "Slow Response", Response, Notice, u, Some(format!("{} ms", p.response_time_ms))));
        }

        // --- Broken outbound links ---
        // Only count genuine breakage: connection failure, 404/410, or 5xx.
        // 401/403/405/429 usually mean bot-blocking or rate-limiting on a HEAD
        // probe, not a dead link, so we don't flag those as broken.
        for link in p.internal_links.iter().chain(p.external_links.iter()) {
            if let Some(&s) = status_map.get(&norm(link)) {
                if s == 0 || s == 404 || s == 410 || s >= 500 {
                    out.push(issue("broken-link", "Broken Link", Links, Error, u, Some(format!("{} → {}", if s == 0 { "ERR".into() } else { s.to_string() }, link))));
                }
            }
        }

        if p.status != 200 {
            continue;
        }

        // --- Titles & meta ---
        match p.title.as_deref() {
            None | Some("") => out.push(issue("title-missing", "Missing Title", TitlesMeta, Error, u, None)),
            Some(t) => {
                let len = t.chars().count();
                if len > TITLE_MAX {
                    out.push(issue("title-too-long", "Title Too Long", TitlesMeta, Warning, u, Some(format!("{len} chars"))));
                } else if len < TITLE_MIN {
                    out.push(issue("title-too-short", "Title Too Short", TitlesMeta, Notice, u, Some(format!("{len} chars"))));
                }
                if dup_title.contains(t) {
                    out.push(issue("title-duplicate", "Duplicate Title", TitlesMeta, Warning, u, None));
                }
            }
        }
        match p.meta_description.as_deref() {
            None | Some("") => out.push(issue("description-missing", "Missing Meta Description", TitlesMeta, Warning, u, None)),
            Some(d) => {
                let len = d.chars().count();
                if len > DESC_MAX {
                    out.push(issue("description-too-long", "Meta Description Too Long", TitlesMeta, Notice, u, Some(format!("{len} chars"))));
                } else if len < DESC_MIN {
                    out.push(issue("description-too-short", "Meta Description Too Short", TitlesMeta, Notice, u, Some(format!("{len} chars"))));
                }
                if dup_desc.contains(d) {
                    out.push(issue("description-duplicate", "Duplicate Meta Description", TitlesMeta, Warning, u, None));
                }
            }
        }

        // --- Headings ---
        if p.h1.is_empty() {
            out.push(issue("h1-missing", "Missing H1", Headings, Warning, u, None));
        } else if p.h1.len() > 1 {
            out.push(issue("h1-multiple", "Multiple H1", Headings, Notice, u, Some(format!("{} H1s", p.h1.len()))));
        }

        // --- Indexability ---
        let meta_noindex = p.meta_robots.as_deref().map(|r| r.contains("noindex")).unwrap_or(false);
        if meta_noindex {
            out.push(issue("noindex", "Noindex", Indexability, Warning, u, None));
        }
        if p.meta_robots.as_deref().map(|r| r.contains("nofollow")).unwrap_or(false) {
            out.push(issue("nofollow", "Nofollow", Indexability, Notice, u, None));
        }
        if !meta_noindex && p.x_robots_tag.as_deref().map(|r| r.to_ascii_lowercase().contains("noindex")).unwrap_or(false) {
            out.push(issue("x-robots-noindex", "X-Robots-Tag: noindex", Indexability, Warning, u, p.x_robots_tag.clone()));
        }

        // --- Canonicals ---
        if p.canonical.is_none() {
            out.push(issue("canonical-missing", "Missing Canonical", Canonical, Notice, u, None));
        } else if p.canonicalized {
            out.push(issue("canonicalised", "Canonicalised", Canonical, Notice, u, p.canonical.clone()));
        }

        // --- Images ---
        if p.images_missing_alt > 0 {
            out.push(issue("image-missing-alt", "Images Missing Alt Text", Images, Warning, u, Some(format!("{} of {} images", p.images_missing_alt, p.images_total))));
        }

        // --- Content ---
        if p.word_count < THIN_WORDS {
            out.push(issue("thin-content", "Thin Content", Content, Notice, u, Some(format!("{} words", p.word_count))));
        }
        if p.size_bytes > LARGE_BYTES {
            out.push(issue("large-page", "Large Page Size", Performance, Notice, u, Some(format!("{} KB", p.size_bytes / 1024))));
        }
        if let Some(canon) = &p.duplicate_of {
            out.push(issue("duplicate-content", "Duplicate Content", Content, Warning, u, Some(format!("Duplicate of {canon}"))));
        }
        if p.text_ratio > 0.0 && p.text_ratio < 0.08 && p.word_count < THIN_WORDS {
            out.push(issue("low-text-ratio", "Low Text-to-HTML Ratio", Content, Notice, u, Some(format!("{:.0}%", p.text_ratio * 100.0))));
        }

        // --- Structure ---
        if p.inlinks == 0 && p.depth > 0 {
            out.push(issue("orphan", "Orphan Page", Links, Notice, u, Some("No internal inlinks".into())));
        }
        if p.depth > DEEP {
            out.push(issue("deep-page", "Deep Page", Links, Notice, u, Some(format!("{} clicks from home", p.depth))));
        }

        // --- Performance ---
        if is_html && p.content_encoding.is_none() && p.size_bytes > 4096 {
            out.push(issue("no-compression", "No Text Compression", Performance, Notice, u, None));
        }

        // --- Security ---
        if p.final_url.starts_with("http://") {
            out.push(issue("not-secure", "Not Served Over HTTPS", Security, Warning, u, None));
        } else {
            if p.mixed_content > 0 {
                out.push(issue("mixed-content", "Mixed Content", Security, Warning, u, Some(format!("{} insecure resources", p.mixed_content))));
            }
            if !p.hsts {
                out.push(issue("no-hsts", "No HSTS Header", Security, Notice, u, None));
            }
        }

        // --- Mobile ---
        if !p.has_viewport {
            out.push(issue("viewport-missing", "Missing Viewport", Mobile, Warning, u, None));
        }

        // --- International ---
        if p.lang.is_none() {
            out.push(issue("lang-missing", "Missing Lang Attribute", International, Notice, u, None));
        }
        if !p.hreflang.is_empty() {
            let has_self = p
                .lang
                .as_deref()
                .map(|l| p.hreflang.iter().any(|h| h.lang.eq_ignore_ascii_case("x-default") || h.lang.to_ascii_lowercase().starts_with(&l.to_ascii_lowercase()[..l.len().min(2)])))
                .unwrap_or(false);
            if !has_self {
                out.push(issue("hreflang-incomplete", "Incomplete hreflang", International, Notice, u, None));
            }
        }

        // Soft SEO/GEO rules only for indexable pages (no point on noindexed).
        if !p.indexable {
            continue;
        }

        // --- Social ---
        if p.og_title.is_none() {
            out.push(issue("og-missing", "Missing Open Graph Tags", Social, Notice, u, None));
        }
        if p.twitter_card.is_none() {
            out.push(issue("twitter-missing", "Missing Twitter Card", Social, Notice, u, None));
        }

        // --- Structured data ---
        if p.schema_types.is_empty() {
            out.push(issue("structured-data-missing", "No Structured Data", StructuredData, Notice, u, None));
        }

        // --- GEO (Generative Engine Optimization) ---
        if p.word_count > 50 {
            if p.geo.score >= GEO_READY {
                out.push(issue("geo-ready", "GEO: AI-Ready Page", Geo, Good, u, Some(format!("{}/100", p.geo.score))));
            } else {
                if !p.geo.structured_data {
                    out.push(issue("geo-no-structured-data", "GEO: No Machine-Readable Structure", Geo, Warning, u, None));
                }
                if !p.geo.answerable {
                    out.push(issue("geo-not-answerable", "GEO: Not Answer-Ready", Geo, Notice, u, None));
                }
                if !p.geo.has_author {
                    out.push(issue("geo-no-author", "GEO: Missing Authorship / E-E-A-T", Geo, Notice, u, None));
                }
                if !p.geo.semantic_html {
                    out.push(issue("geo-no-semantic-html", "GEO: Weak Semantic Structure", Geo, Notice, u, None));
                }
                if p.word_count < 300 {
                    out.push(issue("geo-thin-for-ai", "GEO: Too Thin to Cite", Geo, Notice, u, Some(format!("{} words", p.word_count))));
                }
            }
        }
    }

    // --- Blocked by robots.txt (from crawl-time discovery) ---
    for blocked in robots_blocked {
        out.push(issue("blocked-by-robots", "Blocked by robots.txt", Category::Indexability, Severity::Warning, blocked, None));
    }

    out
}
