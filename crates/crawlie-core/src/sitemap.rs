//! Lightweight sitemap fetching. Parses `<loc>` entries from a sitemap or a
//! sitemap index (following one level of nesting), bounded to a sane cap.

use reqwest::Client;
use std::collections::HashSet;
use url::Url;

const MAX_URLS: usize = 5000;
const MAX_INDEX_CHILDREN: usize = 50;
const MAX_SITEMAP_BYTES: usize = 50 * 1024 * 1024 + 1;

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
    // Crawlie preserves Content-Encoding so page audits can tell whether a
    // response was compressed. That also means special files must explicitly
    // decode their bodies before parsing them; otherwise a Brotli/gzip sitemap
    // looks like binary noise and silently yields zero <loc> entries.
    let encoding = resp
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let raw = crate::fetch::read_body_capped(resp, MAX_SITEMAP_BYTES)
        .await
        .ok()?;
    let decoded = crate::fetch::decode_body(&raw, encoding.as_deref(), MAX_SITEMAP_BYTES);
    Some(String::from_utf8_lossy(&decoded).into_owned())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[tokio::test]
    async fn discovers_urls_from_a_brotli_sitemap() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                <url><loc>https://example.com/one</loc></url>
                <url><loc>https://example.com/two</loc></url>
            </urlset>"#;
        let mut compressed = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut compressed, 4096, 5, 22);
            writer.write_all(xml).unwrap();
        }

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Encoding: br\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                compressed.len()
            )
            .unwrap();
            stream.write_all(&compressed).unwrap();
        });

        let client = crate::fetch::build_client("crawlie-test", 5).unwrap();
        let discovery = discover(&client, &[format!("http://{address}/sitemap.xml")]).await;
        server.join().unwrap();

        assert_eq!(
            discovery.pages,
            vec![
                "https://example.com/one".to_string(),
                "https://example.com/two".to_string(),
            ]
        );
        assert_eq!(discovery.stats.len(), 1);
        assert_eq!(discovery.stats[0].url_count, 2);
    }
}
