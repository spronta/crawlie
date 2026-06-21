//! The crawl driver: breadth-first (Site), single-page (Page), or explicit-list
//! (List) crawling with bounded concurrency, robots.txt + sitemap awareness,
//! followed by inlink counting, duplicate detection, link verification, scoring,
//! and the audit pass.

use crate::audit::audit;
use crate::fetch::{build_client, check_status, fetch, FetchOutcome};
use crate::parse::{parse_html, Parsed};
use crate::robots::Robots;
use crate::scoring::{geo_score, health_score, site_geo_score};
use crate::sitemap;
use crate::types::*;
use futures::stream::{FuturesUnordered, StreamExt};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use url::Url;

/// A cheap clonable cancellation flag shared with a running crawl.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

async fn verify_link(client: reqwest::Client, u: Url) -> (String, u16) {
    let status = check_status(&client, &u).await;
    (normalize(&u), status)
}

fn normalize(u: &Url) -> String {
    let mut u = u.clone();
    u.set_fragment(None);
    u.to_string()
}

fn normalize_str(s: &str) -> String {
    match Url::parse(s) {
        Ok(u) => normalize(&u),
        Err(_) => s.to_string(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Simple glob match (`*` = any run). Falls back to substring when no `*`.
fn glob_match(pattern: &str, text: &str) -> bool {
    if !pattern.contains('*') {
        return text.contains(pattern);
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut pos = 0usize;
    for part in parts.iter() {
        if part.is_empty() {
            continue;
        }
        match text[pos..].find(part) {
            Some(found) => pos += found + part.len(),
            None => return false,
        }
    }
    true
}

/// Non-HTML asset URLs that should never be crawled or audited as pages.
fn is_asset(u: &Url) -> bool {
    let last = u.path().rsplit('/').next().unwrap_or("");
    let Some(dot) = last.rfind('.') else {
        return false;
    };
    let ext = last[dot + 1..].to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "svg"
            | "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "avif"
            | "ico"
            | "bmp"
            | "tiff"
            | "css"
            | "js"
            | "mjs"
            | "cjs"
            | "json"
            | "xml"
            | "rss"
            | "atom"
            | "map"
            | "pdf"
            | "zip"
            | "gz"
            | "tar"
            | "dmg"
            | "exe"
            | "csv"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "eot"
            | "mp4"
            | "webm"
            | "mov"
            | "mp3"
            | "wav"
            | "ogg"
            | "avi"
    )
}

fn passes_filters(config: &CrawlConfig, url: &str) -> bool {
    if !config.include.is_empty() && !config.include.iter().any(|p| glob_match(p, url)) {
        return false;
    }
    if config.exclude.iter().any(|p| glob_match(p, url)) {
        return false;
    }
    true
}

fn robots_path(u: &Url) -> String {
    match u.query() {
        Some(q) => format!("{}?{}", u.path(), q),
        None => u.path().to_string(),
    }
}

/// Run a full crawl + audit. `on_event` receives streaming progress; `cancel`
/// can stop the crawl early (the partial result is still returned).
pub async fn crawl<F>(
    config: CrawlConfig,
    mut on_event: F,
    cancel: CancelToken,
) -> Result<CrawlResult, CrawlError>
where
    F: FnMut(CrawlEvent) + Send,
{
    let start = Instant::now();
    let started_at = now_ms();

    // Resolve the seed(s) and host depending on mode.
    let seeds: Vec<String> = match config.mode {
        CrawlMode::List if !config.urls.is_empty() => config.urls.clone(),
        _ => vec![config.url.clone()],
    };
    let first = seeds.first().cloned().unwrap_or_default();
    let seed = Url::parse(&first).map_err(|e| CrawlError::InvalidUrl(e.to_string()))?;
    if seed.scheme() != "http" && seed.scheme() != "https" {
        return Err(CrawlError::InvalidUrl("URL must be http or https".into()));
    }
    let host = seed
        .host_str()
        .ok_or_else(|| CrawlError::InvalidUrl("URL is missing a host".into()))?
        .to_string();
    let client = build_client(&config.user_agent, config.timeout_secs)
        .map_err(|e| CrawlError::Client(e.to_string()))?;
    let concurrency = config.concurrency.max(1);
    let follow = matches!(config.mode, CrawlMode::Site);
    let max_pages = match config.mode {
        CrawlMode::Page => 1,
        _ => config.max_pages,
    };

    on_event(CrawlEvent::Started {
        url: seed.to_string(),
    });

    // robots.txt
    let robots = if config.respect_robots {
        Robots::fetch(&client, &seed, &config.user_agent).await
    } else {
        Robots::default()
    };
    // `robots.found` is only set when we actually fetched (respect_robots). When
    // we didn't, do a cheap existence check so the audit signal is still accurate.
    let robots_found = if config.respect_robots {
        robots.found
    } else {
        match seed.join("/robots.txt") {
            Ok(u) => check_status(&client, &u).await == 200,
            Err(_) => false,
        }
    };

    // Detect /llms.txt — the emerging AI-engine guidance file.
    let llms_txt_found = match seed.join("/llms.txt") {
        Ok(u) => check_status(&client, &u).await == 200,
        Err(_) => false,
    };

    let mut visited: HashSet<String> = HashSet::new();
    let mut frontier: VecDeque<(Url, usize)> = VecDeque::new();
    let mut robots_blocked: Vec<String> = Vec::new();

    // Seed the frontier.
    for s in &seeds {
        if let Ok(u) = Url::parse(s) {
            if visited.insert(normalize(&u)) {
                frontier.push_back((u, 0));
            }
        }
    }

    // Sitemap seeding (Site mode only).
    let mut sitemap_urls = 0usize;
    if follow && config.use_sitemap {
        let mut sm_locations = robots.sitemaps.clone();
        if sm_locations.is_empty() {
            if let Some(def) = sitemap::default_url(&seed) {
                sm_locations.push(def);
            }
        }
        let discovered = sitemap::discover(&client, &sm_locations).await;
        sitemap_urls = discovered.len();
        for s in discovered {
            if visited.len() >= max_pages {
                break;
            }
            if let Ok(u) = Url::parse(&s) {
                let same = u
                    .host_str()
                    .map(|h| crate::parse::same_site(&host, h))
                    .unwrap_or(false);
                if same && !is_asset(&u) && passes_filters(&config, u.as_str()) {
                    if config.respect_robots && !robots.allowed(&robots_path(&u)) {
                        continue;
                    }
                    if visited.insert(normalize(&u)) {
                        frontier.push_back((u, 0));
                    }
                }
            }
        }
    }

    let mut pages: Vec<Page> = Vec::new();
    let mut inflight = FuturesUnordered::new();
    let mut started = 0usize;

    loop {
        if cancel.is_cancelled() {
            break;
        }
        while inflight.len() < concurrency && started < max_pages {
            let Some((u, depth)) = frontier.pop_front() else {
                break;
            };
            started += 1;
            let client = client.clone();
            let host = host.clone();
            inflight.push(async move {
                let res = fetch(&client, &u, 10).await.map(|o| {
                    let parsed: Option<Parsed> = if o.is_html {
                        o.body
                            .as_deref()
                            .map(|b| parse_html(b, &o.final_url, &host))
                    } else {
                        None
                    };
                    (o, parsed)
                });
                (u, depth, res)
            });
        }

        if inflight.is_empty() {
            break;
        }

        if let Some((u, depth, result)) = inflight.next().await {
            match result {
                Ok((outcome, parsed)) => {
                    let page = build_page(&u, depth, outcome, parsed);
                    visited.insert(normalize_str(&page.final_url));
                    if follow && depth < config.max_depth {
                        for link in &page.internal_links {
                            if visited.len() >= max_pages {
                                break;
                            }
                            if !passes_filters(&config, link) {
                                continue;
                            }
                            let Ok(lu) = Url::parse(link) else { continue };
                            if is_asset(&lu) {
                                continue;
                            }
                            if config.respect_robots && !robots.allowed(&robots_path(&lu)) {
                                if robots_blocked.len() < 200 {
                                    robots_blocked.push(link.clone());
                                }
                                continue;
                            }
                            let key = normalize_str(link);
                            if visited.insert(key) {
                                frontier.push_back((lu, depth + 1));
                            }
                        }
                    }
                    pages.push(page);
                }
                Err(e) => pages.push(error_page(&u, depth, e.to_string())),
            }
            on_event(CrawlEvent::Progress {
                crawled: pages.len(),
                discovered: visited.len(),
                queued: frontier.len() + inflight.len(),
                current: u.to_string(),
            });
        }
    }

    // Inlinks.
    let mut inlinks: HashMap<String, usize> = HashMap::new();
    for p in &pages {
        for l in &p.internal_links {
            *inlinks.entry(normalize_str(l)).or_insert(0) += 1;
        }
    }
    for p in &mut pages {
        p.inlinks = inlinks
            .get(&normalize_str(&p.final_url))
            .copied()
            .unwrap_or(0);
    }

    // Internal-link authority (PageRank).
    let scores = crate::scoring::link_scores(&pages);
    for (i, p) in pages.iter_mut().enumerate() {
        p.link_score = scores[i];
    }

    // Duplicate content detection (exact content-hash match).
    let mut by_hash: HashMap<String, String> = HashMap::new();
    for p in &pages {
        if let Some(h) = &p.content_hash {
            by_hash.entry(h.clone()).or_insert_with(|| p.url.clone());
        }
    }
    for p in &mut pages {
        if let Some(h) = &p.content_hash {
            if let Some(canon) = by_hash.get(h) {
                if canon != &p.url {
                    p.duplicate_of = Some(canon.clone());
                }
            }
        }
    }

    // Status map for broken-link detection + external verification.
    let mut status_map: HashMap<String, u16> = HashMap::new();
    for p in &pages {
        status_map.insert(normalize_str(&p.final_url), p.status);
        status_map.insert(normalize_str(&p.url), p.status);
    }
    if config.check_external && !cancel.is_cancelled() {
        const LINK_CHECK_CAP: usize = 1500;
        let mut targets: Vec<Url> = Vec::new();
        let mut seen = HashSet::new();
        for p in &pages {
            for l in p.internal_links.iter().chain(p.external_links.iter()) {
                let key = normalize_str(l);
                if status_map.contains_key(&key) || !seen.insert(key) {
                    continue;
                }
                if let Ok(u) = Url::parse(l) {
                    targets.push(u);
                }
            }
        }
        targets.truncate(LINK_CHECK_CAP);
        let mut iter = targets.into_iter();
        let mut checks = FuturesUnordered::new();
        for _ in 0..concurrency {
            if let Some(u) = iter.next() {
                checks.push(verify_link(client.clone(), u));
            }
        }
        while let Some((key, status)) = checks.next().await {
            status_map.insert(key, status);
            if cancel.is_cancelled() {
                break;
            }
            if let Some(u) = iter.next() {
                checks.push(verify_link(client.clone(), u));
            }
            on_event(CrawlEvent::Progress {
                crawled: pages.len(),
                discovered: visited.len(),
                queued: checks.len(),
                current: format!("Verifying links… {} checked", status_map.len()),
            });
        }
    }

    // A sitemap exists if we already discovered URLs from one, robots.txt
    // declares one, or the conventional `/sitemap.xml` responds 200. The explicit
    // check covers single-page/list audits where sitemap discovery never ran.
    let sitemap_found = if sitemap_urls > 0 || !robots.sitemaps.is_empty() {
        true
    } else {
        match seed.join("/sitemap.xml") {
            Ok(u) => check_status(&client, &u).await == 200,
            Err(_) => false,
        }
    };

    let mut issues = audit(&pages, &status_map, &robots_blocked, &seed);
    if !robots_found {
        issues.push(Issue {
            rule: "no-robots-txt".into(),
            title: "No robots.txt".into(),
            category: Category::Indexability,
            severity: Severity::Notice,
            url: seed.to_string(),
            detail: None,
        });
    }
    if !sitemap_found {
        issues.push(Issue {
            rule: "no-sitemap".into(),
            title: "No XML sitemap".into(),
            category: Category::Indexability,
            severity: Severity::Warning,
            url: seed.to_string(),
            detail: None,
        });
    }
    if !llms_txt_found {
        issues.push(Issue {
            rule: "geo-no-llms-txt".into(),
            title: "No llms.txt".into(),
            category: Category::Geo,
            severity: Severity::Notice,
            url: seed.to_string(),
            detail: None,
        });
    }
    // Per-page SEO scores (Yoast-style) from each page's own issues.
    let seo = crate::scoring::page_seo_scores(&pages, &issues);
    for (i, p) in pages.iter_mut().enumerate() {
        p.seo_score = seo[i];
    }

    let summary = build_summary(&pages, &issues, start.elapsed().as_millis() as u64);
    on_event(CrawlEvent::Done {
        summary: summary.clone(),
    });

    Ok(CrawlResult {
        config,
        pages,
        issues,
        summary,
        robots_found,
        sitemap_urls,
        sitemap_found,
        robots_blocked,
        llms_txt_found,
        started_at,
    })
}

fn build_page(url: &Url, depth: usize, o: FetchOutcome, parsed: Option<Parsed>) -> Page {
    let final_url_str = o.final_url.to_string();
    let canonical = parsed.as_ref().and_then(|p| p.canonical.clone());
    let canonicalized = canonical
        .as_ref()
        .map(|c| normalize_str(c) != normalize_str(&final_url_str))
        .unwrap_or(false);
    let meta_robots = parsed.as_ref().and_then(|p| p.meta_robots.clone());
    let x_robots = o.x_robots_tag.clone();

    let mut indexable = o.status == 200 && parsed.is_some();
    let mut indexability: Option<String> = None;
    if o.status >= 300 && o.status < 400 {
        indexable = false;
        indexability = Some("Redirect".into());
    } else if o.status >= 400 {
        indexable = false;
        indexability = Some(
            if o.status < 500 {
                "Client Error"
            } else {
                "Server Error"
            }
            .into(),
        );
    }
    let robots_noindex = meta_robots
        .as_deref()
        .map(|r| r.contains("noindex"))
        .unwrap_or(false)
        || x_robots
            .as_deref()
            .map(|r| r.to_ascii_lowercase().contains("noindex"))
            .unwrap_or(false);
    if robots_noindex {
        indexable = false;
        indexability = Some("Noindex".into());
    }
    if canonicalized && indexability.is_none() {
        indexable = false;
        indexability = Some("Canonicalised".into());
    }

    let geo = parsed.as_ref().map(|p| p.geo.clone()).unwrap_or_default();

    let mut page = Page {
        url: normalize(url),
        final_url: final_url_str,
        status: o.status,
        redirect_chain: o.redirects,
        content_type: o.content_type,
        response_time_ms: o.elapsed_ms,
        size_bytes: o.size_bytes,
        depth,
        server: o.server,
        content_encoding: o.content_encoding,
        cache_control: o.cache_control,
        x_robots_tag: x_robots,
        hsts: o.hsts,
        title: parsed.as_ref().and_then(|p| p.title.clone()),
        meta_description: parsed.as_ref().and_then(|p| p.meta_description.clone()),
        h1: parsed.as_ref().map(|p| p.h1.clone()).unwrap_or_default(),
        h2_count: parsed.as_ref().map(|p| p.h2_count).unwrap_or(0),
        h3_count: parsed.as_ref().map(|p| p.h3_count).unwrap_or(0),
        word_count: parsed.as_ref().map(|p| p.word_count).unwrap_or(0),
        text_ratio: parsed.as_ref().map(|p| p.text_ratio).unwrap_or(0.0),
        text: parsed.as_ref().and_then(|p| p.text.clone()),
        canonical,
        meta_robots,
        lang: parsed.as_ref().and_then(|p| p.lang.clone()),
        has_viewport: parsed.as_ref().map(|p| p.has_viewport).unwrap_or(false),
        indexable,
        indexability,
        canonicalized,
        images_total: parsed.as_ref().map(|p| p.images_total).unwrap_or(0),
        images_missing_alt: parsed.as_ref().map(|p| p.images_missing_alt).unwrap_or(0),
        internal_links: parsed
            .as_ref()
            .map(|p| p.internal_links.clone())
            .unwrap_or_default(),
        external_links: parsed
            .as_ref()
            .map(|p| p.external_links.clone())
            .unwrap_or_default(),
        inlinks: 0,
        link_score: 0.0,
        seo_score: 0,
        og_title: parsed.as_ref().and_then(|p| p.og_title.clone()),
        og_image: parsed.as_ref().and_then(|p| p.og_image.clone()),
        twitter_card: parsed.as_ref().and_then(|p| p.twitter_card.clone()),
        schema_types: parsed
            .as_ref()
            .map(|p| p.schema_types.clone())
            .unwrap_or_default(),
        hreflang: parsed
            .as_ref()
            .map(|p| p.hreflang.clone())
            .unwrap_or_default(),
        mixed_content: parsed.as_ref().map(|p| p.mixed_content).unwrap_or(0),
        geo,
        content_hash: parsed.as_ref().and_then(|p| p.content_hash.clone()),
        duplicate_of: None,
        error: None,
    };
    // Score against the real signals now that they're on the page.
    page.geo.score = geo_score(&page);
    page
}

fn error_page(url: &Url, depth: usize, error: String) -> Page {
    Page {
        url: normalize(url),
        final_url: normalize(url),
        status: 0,
        redirect_chain: Vec::new(),
        content_type: None,
        response_time_ms: 0,
        size_bytes: 0,
        depth,
        server: None,
        content_encoding: None,
        cache_control: None,
        x_robots_tag: None,
        hsts: false,
        title: None,
        meta_description: None,
        h1: Vec::new(),
        h2_count: 0,
        h3_count: 0,
        word_count: 0,
        text_ratio: 0.0,
        text: None,
        canonical: None,
        meta_robots: None,
        lang: None,
        has_viewport: false,
        indexable: false,
        indexability: Some("Connection Error".into()),
        canonicalized: false,
        images_total: 0,
        images_missing_alt: 0,
        internal_links: Vec::new(),
        external_links: Vec::new(),
        inlinks: 0,
        link_score: 0.0,
        seo_score: 0,
        og_title: None,
        og_image: None,
        twitter_card: None,
        schema_types: Vec::new(),
        hreflang: Vec::new(),
        mixed_content: 0,
        geo: GeoSignals::default(),
        content_hash: None,
        duplicate_of: None,
        error: Some(error),
    }
}

fn build_summary(pages: &[Page], issues: &[Issue], duration_ms: u64) -> Summary {
    let (mut errors, mut warnings, mut notices, mut good) = (0, 0, 0, 0);
    for i in issues {
        match i.severity {
            Severity::Error => errors += 1,
            Severity::Warning => warnings += 1,
            Severity::Notice => notices += 1,
            Severity::Good => good += 1,
        }
    }
    let mut by_status: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_category: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_depth: BTreeMap<String, usize> = BTreeMap::new();
    let (mut total_rt, mut rt_count, mut indexable, mut dupes) = (0u64, 0u64, 0usize, 0usize);
    for p in pages {
        *by_status.entry(p.status.to_string()).or_insert(0) += 1;
        *by_depth.entry(p.depth.to_string()).or_insert(0) += 1;
        if p.status == 200 {
            total_rt += p.response_time_ms;
            rt_count += 1;
        }
        if p.indexable {
            indexable += 1;
        }
        if p.duplicate_of.is_some() {
            dupes += 1;
        }
    }
    for i in issues {
        if i.severity != Severity::Good {
            *by_category
                .entry(i.category.label().to_string())
                .or_insert(0) += 1;
        }
    }
    Summary {
        total_pages: pages.len(),
        errors,
        warnings,
        notices,
        good,
        health_score: health_score(pages, issues),
        geo_score: site_geo_score(pages),
        avg_response_ms: if rt_count > 0 { total_rt / rt_count } else { 0 },
        indexable_pages: indexable,
        duplicate_pages: dupes,
        by_status,
        by_category,
        by_depth,
        duration_ms,
    }
}
