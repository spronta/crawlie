//! Lightweight sitemap fetching. Parses `<loc>` entries from a sitemap or a
//! sitemap index (following one level of nesting), bounded to a sane cap.

use reqwest::Client;
use std::collections::HashSet;
use url::Url;

const MAX_URLS: usize = 5000;
const MAX_INDEX_CHILDREN: usize = 50;

/// Extract every `<loc>…</loc>` value from sitemap XML.
fn extract_locs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<loc>") {
        rest = &rest[start + 5..];
        if let Some(end) = rest.find("</loc>") {
            let raw = rest[..end].trim();
            // de-entity the few that matter in URLs
            let decoded = raw.replace("&amp;", "&");
            out.push(decoded);
            rest = &rest[end + 6..];
        } else {
            break;
        }
    }
    out
}

async fn fetch_text(client: &Client, url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let resp = client.get(parsed).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

/// Size/shape facts about one fetched sitemap file, for the protocol-limit
/// audit rules (50,000 URLs / 50 MB uncompressed per file).
pub struct SitemapStat {
    /// The sitemap file's own URL.
    pub url: String,
    /// Uncompressed byte size of the fetched XML.
    pub bytes: usize,
    /// Number of `<loc>` entries in this file (before any crawl cap).
    pub url_count: usize,
}

/// What sitemap discovery found: the de-duplicated page URLs (capped) plus
/// per-file stats for every sitemap actually fetched.
pub struct Discovery {
    pub pages: Vec<String>,
    pub stats: Vec<SitemapStat>,
}

/// Discover page URLs from one or more sitemap URLs. Follows sitemap indexes one
/// level deep and de-duplicates results.
pub async fn discover(client: &Client, sitemap_urls: &[String]) -> Discovery {
    let mut seen = HashSet::new();
    let mut pages = Vec::new();
    let mut stats = Vec::new();
    let mut full = false;

    'outer: for sm in sitemap_urls.iter().take(MAX_INDEX_CHILDREN) {
        let Some(body) = fetch_text(client, sm).await else {
            continue;
        };
        let is_index = body.contains("<sitemapindex");
        let locs = extract_locs(&body);
        stats.push(SitemapStat {
            url: sm.clone(),
            bytes: body.len(),
            url_count: if is_index { 0 } else { locs.len() },
        });

        if is_index {
            for child in locs.into_iter().take(MAX_INDEX_CHILDREN) {
                if let Some(child_body) = fetch_text(client, &child).await {
                    let child_locs = extract_locs(&child_body);
                    stats.push(SitemapStat {
                        url: child,
                        bytes: child_body.len(),
                        url_count: child_locs.len(),
                    });
                    for loc in child_locs {
                        if full {
                            continue;
                        }
                        if seen.insert(loc.clone()) {
                            pages.push(loc);
                            full = pages.len() >= MAX_URLS;
                        }
                    }
                }
            }
        } else {
            for loc in locs {
                if seen.insert(loc.clone()) {
                    pages.push(loc);
                    if pages.len() >= MAX_URLS {
                        break 'outer;
                    }
                }
            }
        }
    }
    Discovery { pages, stats }
}

/// Default sitemap location for a host.
pub fn default_url(base: &Url) -> Option<String> {
    base.join("/sitemap.xml").ok().map(|u| u.to_string())
}
