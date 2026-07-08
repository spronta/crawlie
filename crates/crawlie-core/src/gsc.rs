//! Google Search Console cross-referencing — without OAuth. Users export the
//! Performance → Pages table from Search Console (a two-click CSV download)
//! and crawlie joins it against a saved crawl: search traffic landing on
//! noindexed/broken/redirecting pages, URLs Google shows that the crawl never
//! found (GSC orphans), and indexable pages earning zero impressions.

use crate::types::Page;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One row of a GSC Performance "Pages" export.
#[derive(Debug, Clone)]
pub struct GscRow {
    pub url: String,
    pub clicks: u64,
    pub impressions: u64,
}

/// Split one CSV line, honouring double-quoted fields (GSC quotes URLs that
/// contain commas).
fn split_csv(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => out.push(std::mem::take(&mut field)),
            _ => field.push(c),
        }
    }
    out.push(field);
    out
}

/// Parse a GSC Pages export: header row skipped, columns read positionally
/// (URL, clicks, impressions) so localized headers don't matter.
pub fn parse_csv(text: &str) -> Vec<GscRow> {
    let mut rows = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let fields = split_csv(line);
        if fields.len() < 3 {
            continue;
        }
        let url = fields[0].trim().to_string();
        // Skip the header (first column isn't a URL).
        if i == 0 && !url.starts_with("http") {
            continue;
        }
        let num = |s: &str| s.trim().replace(',', "").parse::<u64>().unwrap_or(0);
        rows.push(GscRow {
            clicks: num(&fields[1]),
            impressions: num(&fields[2]),
            url,
        });
    }
    rows
}

/// The cross-reference result. URL lists are sorted by clicks/impressions
/// descending and capped.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GscAnalysis {
    pub gsc_rows: usize,
    pub crawled_pages: usize,
    /// Search traffic landing on noindexed pages: (url, clicks).
    pub traffic_to_noindex: Vec<(String, u64)>,
    /// Search traffic landing on 4xx/5xx pages: (url, clicks, status).
    pub traffic_to_error: Vec<(String, u64, u16)>,
    /// Search traffic landing on redirecting URLs: (url, clicks).
    pub traffic_to_redirect: Vec<(String, u64)>,
    /// Search traffic landing on canonicalised pages: (url, clicks).
    pub traffic_to_canonicalized: Vec<(String, u64)>,
    /// URLs with impressions that the crawl never found: (url, impressions).
    pub gsc_orphans: Vec<(String, u64)>,
    /// Indexable crawled pages with no GSC row at all (zero impressions).
    pub zero_impressions: Vec<String>,
}

const CAP: usize = 50;

fn key(u: &str) -> String {
    u.split('#')
        .next()
        .unwrap_or(u)
        .trim_end_matches('/')
        .to_string()
}

/// Join GSC performance rows against crawled pages.
pub fn analyze(rows: &[GscRow], pages: &[Page]) -> GscAnalysis {
    let mut a = GscAnalysis {
        gsc_rows: rows.len(),
        crawled_pages: pages.len(),
        ..Default::default()
    };
    let by_url: HashMap<String, &Page> = pages
        .iter()
        .flat_map(|p| [(key(&p.url), p), (key(&p.final_url), p)])
        .collect();

    let noindex = |p: &Page| {
        p.meta_robots
            .as_deref()
            .map(|r| r.contains("noindex"))
            .unwrap_or(false)
            || p.x_robots_tag
                .as_deref()
                .map(|r| r.to_ascii_lowercase().contains("noindex"))
                .unwrap_or(false)
    };

    for row in rows {
        match by_url.get(&key(&row.url)) {
            Some(p) => {
                if p.status >= 400 || p.status == 0 {
                    a.traffic_to_error
                        .push((row.url.clone(), row.clicks, p.status));
                } else if (300..400).contains(&p.status) {
                    a.traffic_to_redirect.push((row.url.clone(), row.clicks));
                } else if noindex(p) {
                    a.traffic_to_noindex.push((row.url.clone(), row.clicks));
                } else if p.canonicalized {
                    a.traffic_to_canonicalized
                        .push((row.url.clone(), row.clicks));
                }
            }
            None => {
                if row.impressions > 0 {
                    a.gsc_orphans.push((row.url.clone(), row.impressions));
                }
            }
        }
    }

    let in_gsc: std::collections::HashSet<String> = rows.iter().map(|r| key(&r.url)).collect();
    a.zero_impressions = pages
        .iter()
        .filter(|p| p.status == 200 && p.indexable && !in_gsc.contains(&key(&p.url)))
        .map(|p| p.url.clone())
        .collect();
    a.zero_impressions.sort();
    a.zero_impressions.truncate(CAP);

    a.traffic_to_noindex.sort_by(|x, y| y.1.cmp(&x.1));
    a.traffic_to_error.sort_by(|x, y| y.1.cmp(&x.1));
    a.traffic_to_redirect.sort_by(|x, y| y.1.cmp(&x.1));
    a.traffic_to_canonicalized.sort_by(|x, y| y.1.cmp(&x.1));
    a.gsc_orphans.sort_by(|x, y| y.1.cmp(&x.1));
    for v in [
        &mut a.traffic_to_noindex,
        &mut a.traffic_to_redirect,
        &mut a.traffic_to_canonicalized,
    ] {
        v.truncate(CAP);
    }
    a.traffic_to_error.truncate(CAP);
    a.gsc_orphans.truncate(CAP);
    a
}
