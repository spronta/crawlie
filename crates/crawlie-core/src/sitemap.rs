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

/// Discover page URLs from one or more sitemap URLs. Follows sitemap indexes one
/// level deep and de-duplicates results.
pub async fn discover(client: &Client, sitemap_urls: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut pages = Vec::new();

    for sm in sitemap_urls.iter().take(MAX_INDEX_CHILDREN) {
        let Some(body) = fetch_text(client, sm).await else {
            continue;
        };
        let is_index = body.contains("<sitemapindex");
        let locs = extract_locs(&body);

        if is_index {
            for child in locs.into_iter().take(MAX_INDEX_CHILDREN) {
                if let Some(child_body) = fetch_text(client, &child).await {
                    for loc in extract_locs(&child_body) {
                        if seen.insert(loc.clone()) {
                            pages.push(loc);
                            if pages.len() >= MAX_URLS {
                                return pages;
                            }
                        }
                    }
                }
            }
        } else {
            for loc in locs {
                if seen.insert(loc.clone()) {
                    pages.push(loc);
                    if pages.len() >= MAX_URLS {
                        return pages;
                    }
                }
            }
        }
    }
    pages
}

/// Default sitemap location for a host.
pub fn default_url(base: &Url) -> Option<String> {
    base.join("/sitemap.xml").ok().map(|u| u.to_string())
}
