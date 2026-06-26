//! The crawl driver: breadth-first (Site), single-page (Page), or explicit-list
//! (List) crawling with bounded concurrency, robots.txt + sitemap awareness,
//! followed by inlink counting, duplicate detection, link verification, scoring,
//! and the audit pass.

use crate::audit::{audit, audit_one};
use crate::fetch::{build_client, check_status, fetch, FetchOutcome};
use crate::pagestore::PageStore;
use crate::parse::{parse_html, Parsed};
use crate::render::Renderer;
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

/// One fetched (and optionally rendered) page, ready to become a [`Page`].
struct Fetched {
    outcome: FetchOutcome,
    parsed: Option<Parsed>,
    rendered: bool,
    pre_render_word_count: usize,
}

/// Fetch one URL, then — when a renderer is supplied — re-acquire its
/// post-JavaScript DOM with headless Chrome and parse *that* instead, so every
/// downstream audit rule sees client-rendered content. The raw server HTML's
/// word count is captured first so the gap between raw and rendered can flag
/// JS-dependent content. A render failure is non-fatal: the raw HTML is used.
async fn fetch_one(
    client: &reqwest::Client,
    renderer: Option<&Renderer>,
    u: &Url,
    host: &str,
    extractors: &[Extractor],
    render_wait_ms: u64,
) -> Result<Fetched, reqwest::Error> {
    let o = fetch(client, u, 10).await?;
    let mut rendered = false;
    let mut pre_render_word_count = 0usize;
    let mut html = o.body.clone();

    if o.is_html && o.status == 200 {
        if let Some(r) = renderer {
            // Count words in the raw payload (before any JS) for the JS-content gap.
            if let Some(raw) = o.body.as_deref() {
                pre_render_word_count = parse_html(raw, &o.final_url, host, &[]).word_count;
            }
            if let Ok(dom) = r.render_html(&o.final_url, render_wait_ms).await {
                html = Some(dom);
                rendered = true;
            }
        }
    }

    let parsed = if o.is_html {
        html.as_deref()
            .map(|b| parse_html(b, &o.final_url, host, extractors))
    } else {
        None
    };
    // With no render, pre == post by definition (keeps the field meaningful).
    if !rendered {
        pre_render_word_count = parsed.as_ref().map(|p| p.word_count).unwrap_or(0);
    }

    Ok(Fetched {
        outcome: o,
        parsed,
        rendered,
        pre_render_word_count,
    })
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

/// Pre-compiled host/path exclusion rules, built once per crawl so regexes
/// aren't recompiled on every discovered link. Substrings and regexes are kept
/// apart for cheap matching.
#[derive(Default)]
struct ExcludeFilters {
    host_subs: Vec<String>,
    host_res: Vec<regex::Regex>,
    path_subs: Vec<String>,
    path_res: Vec<regex::Regex>,
}

impl ExcludeFilters {
    /// Compile the config's exclusion rules, returning a human-readable error on
    /// the first invalid regex so a typo fails the crawl up front.
    fn build(config: &CrawlConfig) -> Result<Self, String> {
        fn add(
            rules: &[UrlFilter],
            subs: &mut Vec<String>,
            res: &mut Vec<regex::Regex>,
            what: &str,
        ) -> Result<(), String> {
            for r in rules {
                let v = r.value.trim();
                if v.is_empty() {
                    continue;
                }
                if r.regex {
                    let re = regex::Regex::new(v)
                        .map_err(|e| format!("excluded {what} regex '{v}': {e}"))?;
                    res.push(re);
                } else {
                    subs.push(v.to_string());
                }
            }
            Ok(())
        }
        let mut f = ExcludeFilters::default();
        add(
            &config.exclude_hosts,
            &mut f.host_subs,
            &mut f.host_res,
            "host",
        )?;
        add(
            &config.exclude_paths,
            &mut f.path_subs,
            &mut f.path_res,
            "path",
        )?;
        Ok(f)
    }

    /// Whether `u` should be skipped: its host matches any host rule, or its path
    /// matches any path rule.
    fn excluded(&self, u: &Url) -> bool {
        if !self.host_subs.is_empty() || !self.host_res.is_empty() {
            let host = u.host_str().unwrap_or("");
            if self.host_subs.iter().any(|s| host.contains(s.as_str()))
                || self.host_res.iter().any(|r| r.is_match(host))
            {
                return true;
            }
        }
        if !self.path_subs.is_empty() || !self.path_res.is_empty() {
            let path = u.path();
            if self.path_subs.iter().any(|s| path.contains(s.as_str()))
                || self.path_res.iter().any(|r| r.is_match(path))
            {
                return true;
            }
        }
        false
    }
}

fn robots_path(u: &Url) -> String {
    match u.query() {
        Some(q) => format!("{}?{}", u.path(), q),
        None => u.path().to_string(),
    }
}

/// Everything resolved before the fetch loop: the seed/host/client, robots and
/// llms.txt findings, and the seeded frontier. Shared by the in-memory [`crawl`]
/// and the streaming [`crawl_to_store`] so the robots/sitemap/seed logic lives
/// in one place.
struct Prep {
    seed: Url,
    host: String,
    client: reqwest::Client,
    renderer: Option<Arc<Renderer>>,
    filters: ExcludeFilters,
    robots: Robots,
    robots_found: bool,
    llms_txt_found: bool,
    frontier: VecDeque<(Url, usize)>,
    visited: HashSet<String>,
    sitemap_urls: usize,
    robots_blocked: Vec<String>,
    max_pages: usize,
    follow: bool,
    concurrency: usize,
}

async fn prepare<F>(config: &CrawlConfig, on_event: &mut F) -> Result<Prep, CrawlError>
where
    F: FnMut(CrawlEvent),
{
    // Fail fast on a malformed extractor instead of silently extracting nothing.
    crate::parse::validate_extractors(&config.extract).map_err(CrawlError::Config)?;
    // Compile host/path exclusion rules once (fails fast on a bad regex).
    let filters = ExcludeFilters::build(config).map_err(CrawlError::Config)?;

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

    // Launch the headless browser once, up front, so a misconfigured render mode
    // fails the crawl immediately instead of after fetching the seed.
    let renderer = if config.render {
        let nav_timeout = config.timeout_secs.saturating_mul(2).max(20);
        match Renderer::launch(None, nav_timeout).await {
            Ok(r) => Some(Arc::new(r)),
            Err(e) => return Err(CrawlError::Config(format!("render mode: {e}"))),
        }
    } else {
        None
    };

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
    let robots_blocked: Vec<String> = Vec::new();

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
                if same
                    && !is_asset(&u)
                    && passes_filters(config, u.as_str())
                    && !filters.excluded(&u)
                {
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

    Ok(Prep {
        seed,
        host,
        client,
        renderer,
        filters,
        robots,
        robots_found,
        llms_txt_found,
        frontier,
        visited,
        sitemap_urls,
        robots_blocked,
        max_pages,
        follow,
        concurrency,
    })
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
    let Prep {
        seed,
        host,
        client,
        renderer,
        filters,
        robots,
        robots_found,
        llms_txt_found,
        mut frontier,
        mut visited,
        sitemap_urls,
        mut robots_blocked,
        max_pages,
        follow,
        concurrency,
    } = prepare(&config, &mut on_event).await?;

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
            let extractors = config.extract.clone();
            let renderer = renderer.clone();
            let render_wait = config.render_wait_ms;
            inflight.push(async move {
                let res = fetch_one(
                    &client,
                    renderer.as_deref(),
                    &u,
                    &host,
                    &extractors,
                    render_wait,
                )
                .await;
                (u, depth, res)
            });
        }

        if inflight.is_empty() {
            break;
        }

        if let Some((u, depth, result)) = inflight.next().await {
            match result {
                Ok(Fetched {
                    outcome,
                    parsed,
                    rendered,
                    pre_render_word_count,
                }) => {
                    let page =
                        build_page(&u, depth, outcome, parsed, rendered, pre_render_word_count);
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
                            if filters.excluded(&lu) {
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

/// Like [`crawl`], but streams every fetched page straight to an on-disk
/// [`PageStore`] at `store_path` instead of accumulating a `Vec<Page>` — so a
/// site too large to hold in RAM can still be crawled and audited. The cross-
/// page passes (inlinks, PageRank, dedup, audit) run by streaming pages back
/// from disk one at a time; peak memory is bounded by compact metadata (a
/// url→id map, an integer edge graph, the issue list) rather than the corpus.
///
/// The returned `CrawlResult` has the full `issues`/`summary` but an **empty
/// `pages`** — the pages are the store, which is returned alongside it as the
/// queryable artifact. Audit output is identical to [`crawl`].
pub async fn crawl_to_store<F>(
    config: CrawlConfig,
    store_path: impl AsRef<std::path::Path>,
    mut on_event: F,
    cancel: CancelToken,
) -> Result<(CrawlResult, PageStore), CrawlError>
where
    F: FnMut(CrawlEvent) + Send,
{
    let start = Instant::now();
    let started_at = now_ms();
    let store = PageStore::create(store_path).map_err(|e| CrawlError::Client(e.to_string()))?;
    let store_path = store.path().to_path_buf();
    let Prep {
        seed,
        host,
        client,
        renderer,
        filters,
        robots,
        robots_found,
        llms_txt_found,
        mut frontier,
        mut visited,
        sitemap_urls,
        mut robots_blocked,
        max_pages,
        follow,
        concurrency,
    } = prepare(&config, &mut on_event).await?;

    // --- Fetch loop: each finished page is written to disk, not retained. ---
    let mut inflight = FuturesUnordered::new();
    let mut started = 0usize;
    let mut crawled = 0usize;
    store
        .begin()
        .map_err(|e| CrawlError::Client(e.to_string()))?;
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
            let extractors = config.extract.clone();
            let renderer = renderer.clone();
            let render_wait = config.render_wait_ms;
            inflight.push(async move {
                let res = fetch_one(
                    &client,
                    renderer.as_deref(),
                    &u,
                    &host,
                    &extractors,
                    render_wait,
                )
                .await;
                (u, depth, res)
            });
        }

        if inflight.is_empty() {
            break;
        }

        if let Some((u, depth, result)) = inflight.next().await {
            let page = match result {
                Ok(Fetched {
                    outcome,
                    parsed,
                    rendered,
                    pre_render_word_count,
                }) => {
                    let page =
                        build_page(&u, depth, outcome, parsed, rendered, pre_render_word_count);
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
                            if filters.excluded(&lu) {
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
                    page
                }
                Err(e) => error_page(&u, depth, e.to_string()),
            };
            store
                .insert(&page)
                .map_err(|e| CrawlError::Client(e.to_string()))?;
            crawled += 1;
            on_event(CrawlEvent::Progress {
                crawled,
                discovered: visited.len(),
                queued: frontier.len() + inflight.len(),
                current: u.to_string(),
            });
        }
    }
    store
        .commit()
        .map_err(|e| CrawlError::Client(e.to_string()))?;

    let ioerr = |e: std::io::Error| CrawlError::Client(e.to_string());

    // Internal-link authority (PageRank) over the on-disk edge graph.
    let link_scores = crate::scoring::pagerank(&store.adjacency().map_err(ioerr)?);
    // Inlink counts and duplicate canonicals, as SQL aggregates.
    let inlink_counts = store.inlink_counts().map_err(ioerr)?;
    let hash_canon = store.hash_canon().map_err(ioerr)?;
    // Duplicate title/description sets (the cross-page audit context).
    let cross = store.cross_page().map_err(ioerr)?;

    // Status map (+ external link verification), streamed from disk.
    let mut status_map = store.status_map().map_err(ioerr)?;
    if config.check_external && !cancel.is_cancelled() {
        const LINK_CHECK_CAP: usize = 1500;
        let mut targets: Vec<Url> = Vec::new();
        let mut seen = HashSet::new();
        store
            .for_each_page(|_, p| {
                if targets.len() >= LINK_CHECK_CAP {
                    return;
                }
                for l in p.internal_links.iter().chain(p.external_links.iter()) {
                    let key = normalize_str(l);
                    if status_map.contains_key(&key) || !seen.insert(key) {
                        continue;
                    }
                    if let Ok(u) = Url::parse(l) {
                        targets.push(u);
                    }
                }
            })
            .map_err(ioerr)?;
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
                crawled,
                discovered: visited.len(),
                queued: checks.len(),
                current: format!("Verifying links… {} checked", status_map.len()),
            });
        }
    }

    let sitemap_found = if sitemap_urls > 0 || !robots.sitemaps.is_empty() {
        true
    } else {
        match seed.join("/sitemap.xml") {
            Ok(u) => check_status(&client, &u).await == 200,
            Err(_) => false,
        }
    };

    // --- Audit + summary: stream pages back one at a time. ---
    let mut issues: Vec<Issue> = Vec::new();
    let mut acc = SummaryAcc::default();
    store
        .for_each_page(|_, mut p| {
            // Derived fields the audit reads must be set before auditing.
            p.inlinks = inlink_counts
                .get(&normalize_str(&p.final_url))
                .copied()
                .unwrap_or(0);
            p.duplicate_of = p
                .content_hash
                .as_ref()
                .and_then(|h| hash_canon.get(h).filter(|canon| *canon != &p.url).cloned());
            acc.add(&p);
            audit_one(&p, &cross, &status_map, &mut issues);
        })
        .map_err(ioerr)?;
    // Robots/sitemap/robots-blocked issues are appended here (the per-page audit
    // ran inline above instead of via `audit`).
    for blocked in &robots_blocked {
        issues.push(Issue {
            rule: "blocked-by-robots".into(),
            title: "Blocked by robots.txt".into(),
            category: Category::Indexability,
            severity: Severity::Warning,
            url: blocked.clone(),
            detail: None,
        });
    }
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

    // Per-page SEO penalty (Yoast-style), grouped by URL — applied in write-back.
    let seo_penalty = seo_penalty_by_url(&issues);

    // --- Write derived fields back into the stored pages (bounded memory: a
    // second read connection streams pages while this connection updates). ---
    let reader = PageStore::open(&store_path).map_err(ioerr)?;
    store.begin().map_err(ioerr)?;
    reader
        .for_each_page(|id, mut p| {
            p.inlinks = inlink_counts
                .get(&normalize_str(&p.final_url))
                .copied()
                .unwrap_or(0);
            p.link_score = link_scores.get(id).copied().unwrap_or(0.0);
            p.duplicate_of = p
                .content_hash
                .as_ref()
                .and_then(|h| hash_canon.get(h).filter(|canon| *canon != &p.url).cloned());
            p.seo_score = if p.status == 200 {
                let pen = seo_penalty
                    .get(&normalize_str(&p.url))
                    .copied()
                    .unwrap_or(0.0);
                (100.0 - pen).clamp(0.0, 100.0).round() as u8
            } else {
                0
            };
            let _ = store.put_blob(id, &p);
        })
        .map_err(ioerr)?;
    store.commit().map_err(ioerr)?;

    let summary = acc.finish(&issues, start.elapsed().as_millis() as u64);
    on_event(CrawlEvent::Done {
        summary: summary.clone(),
    });

    let result = CrawlResult {
        config,
        pages: Vec::new(),
        issues,
        summary,
        robots_found,
        sitemap_urls,
        sitemap_found,
        robots_blocked,
        llms_txt_found,
        started_at,
    };
    // Persist the findings + metadata so the .db is a complete, queryable crawl.
    store.finalize(&result).map_err(ioerr)?;
    Ok((result, store))
}

/// Per-URL SEO penalty from non-GEO issues — the streaming counterpart of
/// [`crate::scoring::page_seo_scores`]'s penalty step.
fn seo_penalty_by_url(issues: &[Issue]) -> HashMap<String, f32> {
    let mut penalty: HashMap<String, f32> = HashMap::new();
    for i in issues {
        if i.category == Category::Geo {
            continue;
        }
        let w = match i.severity {
            Severity::Error => 15.0,
            Severity::Warning => 7.0,
            Severity::Notice => 2.0,
            Severity::Good => 0.0,
        };
        *penalty.entry(normalize_str(&i.url)).or_insert(0.0) += w;
    }
    penalty
}

/// Streaming accumulator for the page-derived parts of [`Summary`] — fed one
/// page at a time so the streaming crawl never holds the whole corpus.
#[derive(Default)]
struct SummaryAcc {
    n: usize,
    by_status: BTreeMap<String, usize>,
    by_depth: BTreeMap<String, usize>,
    total_rt: u64,
    rt_count: u64,
    indexable: usize,
    dupes: usize,
    geo_sum: u32,
    geo_count: u32,
}

impl SummaryAcc {
    fn add(&mut self, p: &Page) {
        self.n += 1;
        *self.by_status.entry(p.status.to_string()).or_insert(0) += 1;
        *self.by_depth.entry(p.depth.to_string()).or_insert(0) += 1;
        if p.status == 200 {
            self.total_rt += p.response_time_ms;
            self.rt_count += 1;
        }
        if p.indexable {
            self.indexable += 1;
        }
        if p.duplicate_of.is_some() {
            self.dupes += 1;
        }
        if p.status == 200 && p.indexable {
            self.geo_sum += p.geo.score as u32;
            self.geo_count += 1;
        }
    }

    fn finish(self, issues: &[Issue], duration_ms: u64) -> Summary {
        let (mut errors, mut warnings, mut notices, mut good) = (0, 0, 0, 0);
        let mut by_category: BTreeMap<String, usize> = BTreeMap::new();
        for i in issues {
            match i.severity {
                Severity::Error => errors += 1,
                Severity::Warning => warnings += 1,
                Severity::Notice => notices += 1,
                Severity::Good => good += 1,
            }
            if i.severity != Severity::Good {
                *by_category
                    .entry(i.category.label().to_string())
                    .or_insert(0) += 1;
            }
        }
        Summary {
            total_pages: self.n,
            errors,
            warnings,
            notices,
            good,
            health_score: crate::scoring::health_score_n(self.n, issues),
            geo_score: if self.geo_count > 0 {
                (self.geo_sum / self.geo_count) as u8
            } else {
                0
            },
            avg_response_ms: if self.rt_count > 0 {
                self.total_rt / self.rt_count
            } else {
                0
            },
            indexable_pages: self.indexable,
            duplicate_pages: self.dupes,
            by_status: self.by_status,
            by_category,
            by_depth: self.by_depth,
            duration_ms,
        }
    }
}

fn build_page(
    url: &Url,
    depth: usize,
    o: FetchOutcome,
    parsed: Option<Parsed>,
    rendered: bool,
    pre_render_word_count: usize,
) -> Page {
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
        rendered,
        pre_render_word_count,
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
        schema_validations: parsed
            .as_ref()
            .map(|p| p.schema_validations.clone())
            .unwrap_or_default(),
        invalid_jsonld: parsed.as_ref().map(|p| p.invalid_jsonld).unwrap_or(0),
        hreflang: parsed
            .as_ref()
            .map(|p| p.hreflang.clone())
            .unwrap_or_default(),
        mixed_content: parsed.as_ref().map(|p| p.mixed_content).unwrap_or(0),
        geo,
        extractions: parsed
            .as_ref()
            .map(|p| p.extractions.clone())
            .unwrap_or_default(),
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
        rendered: false,
        pre_render_word_count: 0,
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
        schema_validations: Vec::new(),
        invalid_jsonld: 0,
        hreflang: Vec::new(),
        mixed_content: 0,
        geo: GeoSignals::default(),
        extractions: Vec::new(),
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

#[cfg(test)]
mod filter_tests {
    use super::*;
    use crate::types::UrlFilter;

    fn cfg(hosts: Vec<UrlFilter>, paths: Vec<UrlFilter>) -> CrawlConfig {
        let mut c = CrawlConfig::new("https://example.com");
        c.exclude_hosts = hosts;
        c.exclude_paths = paths;
        c
    }
    fn sub(v: &str) -> UrlFilter {
        UrlFilter {
            value: v.into(),
            regex: false,
        }
    }
    fn re(v: &str) -> UrlFilter {
        UrlFilter {
            value: v.into(),
            regex: true,
        }
    }
    fn url(u: &str) -> Url {
        Url::parse(u).unwrap()
    }

    #[test]
    fn host_substring_and_regex_exclusion() {
        let f = ExcludeFilters::build(&cfg(vec![sub("twitter"), re(r"^ads\.")], vec![])).unwrap();
        assert!(f.excluded(&url("https://twitter.com/x")));
        assert!(f.excluded(&url("https://ads.example.com/")));
        assert!(!f.excluded(&url("https://example.com/")));
    }

    #[test]
    fn path_substring_and_regex_exclusion() {
        let f = ExcludeFilters::build(&cfg(vec![], vec![sub("/share"), re(r"\.php$")])).unwrap();
        assert!(f.excluded(&url("https://example.com/share/this")));
        assert!(f.excluded(&url("https://example.com/page.php")));
        assert!(!f.excluded(&url("https://example.com/about")));
    }

    #[test]
    fn empty_filters_exclude_nothing_and_bad_regex_errors() {
        let none = ExcludeFilters::build(&cfg(vec![], vec![])).unwrap();
        assert!(!none.excluded(&url("https://anything.example/path")));
        assert!(ExcludeFilters::build(&cfg(vec![re("(")], vec![])).is_err());
    }
}
