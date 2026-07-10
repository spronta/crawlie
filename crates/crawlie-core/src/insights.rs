//! Server-side "audit breakdowns" for the Insights tab — the segmented-bar grid
//! (indexability, canonicals, structured data, content, status, speed, depth,
//! security, social, images, mobile, international).
//!
//! These used to be computed in the browser from the hydrated page window, so a
//! big (lean, out-of-core) report only ever charted its first N pages while the
//! scores and issues already covered the whole crawl. Folding them here — one
//! streaming pass over every crawled page — makes the tab reflect the **full**
//! crawl too. The accumulator mirrors the former client computation
//! field-for-field so the output is identical.

use serde::{Deserialize, Serialize};

use crate::types::Page;

/// Semantic colour of a segment. The frontend maps each tone to a CSS var, so
/// presentation stays in the UI and this layer only carries meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Good,
    Warn,
    Bad,
    Critical,
    Info,
    Muted,
}

/// One segment of a breakdown bar: a labelled count with a semantic tone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub label: String,
    pub count: usize,
    pub tone: Tone,
}

/// One breakdown card: a title, the denominator it's measured against, and its
/// segments. Zero-count segments are kept — the frontend drops them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub title: String,
    pub total: usize,
    pub bars: Vec<Segment>,
}

/// Streaming accumulator: fold every crawled page in with [`InsightsAcc::add`],
/// then [`InsightsAcc::finish`] into the ordered set of breakdown cards.
#[derive(Debug, Default, Clone)]
pub struct InsightsAcc {
    n: usize,    // all pages
    html: usize, // status == 200
    // indexability (html pages)
    noindex: usize,
    canonicalized: usize,
    // canonical tag (html pages)
    canon_self: usize,
    canon_other: usize,
    canon_missing: usize,
    // structured data (html pages)
    with_schema: usize,
    invalid_jsonld: usize,
    // content
    dupes: usize, // all pages (matches the UI)
    thin: usize,  // html pages
    // http status bands (all pages)
    s2: usize,
    s3: usize,
    s4: usize,
    s5: usize,
    // response speed (html pages)
    fast: usize,
    moderate: usize,
    slow: usize,
    // crawl depth (all pages)
    d0: usize,
    d1: usize,
    d2: usize,
    d3plus: usize,
    // security (all pages)
    https_hsts: usize,
    https_only: usize,
    insecure: usize,
    // social (html pages)
    og_both: usize,
    og_partial: usize,
    og_missing: usize,
    // images (image-level, over html pages)
    img_total: usize,
    img_missing: usize,
    // mobile (html pages)
    viewport: usize,
    no_viewport: usize,
    // international (html pages)
    with_hreflang: usize,
}

/// JS-style truthiness for an optional string: present *and* non-empty.
fn truthy(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|v| !v.is_empty())
}

impl InsightsAcc {
    /// Fold one crawled page into the running totals.
    pub fn add(&mut self, p: &Page) {
        self.n += 1;

        // HTTP status bands — over every page.
        match p.status {
            200..=299 => self.s2 += 1,
            300..=399 => self.s3 += 1,
            400..=499 => self.s4 += 1,
            500..=599 => self.s5 += 1,
            _ => {}
        }

        // Crawl depth — over every page.
        match p.depth {
            0 => self.d0 += 1,
            1 => self.d1 += 1,
            2 => self.d2 += 1,
            _ => self.d3plus += 1,
        }

        // Duplicate content — counted across every page (matches the UI).
        if p.duplicate_of.is_some() {
            self.dupes += 1;
        }

        // Security — over every page; final URL falls back to the request URL.
        let final_url = if p.final_url.is_empty() {
            &p.url
        } else {
            &p.final_url
        };
        let https = final_url.starts_with("https://");
        if https && p.hsts {
            self.https_hsts += 1;
        } else if https {
            self.https_only += 1;
        }
        if !https || p.mixed_content > 0 {
            self.insecure += 1;
        }

        // Everything below is measured over HTML (200) pages only.
        if p.status != 200 {
            return;
        }
        self.html += 1;

        // Indexability.
        let noindexed = p
            .indexability
            .as_deref()
            .is_some_and(|s| s.to_lowercase().contains("noindex"))
            || !p.indexable;
        if noindexed {
            self.noindex += 1;
        }
        if p.canonicalized {
            self.canonicalized += 1;
        }

        // Canonical tag.
        match p.canonical.as_deref() {
            Some(c) if !c.is_empty() && c == p.url => self.canon_self += 1,
            Some(c) if !c.is_empty() => self.canon_other += 1,
            _ => self.canon_missing += 1,
        }

        // Structured data.
        if !p.schema_types.is_empty() {
            self.with_schema += 1;
        }
        if p.invalid_jsonld > 0 {
            self.invalid_jsonld += 1;
        }

        // Content — thin body.
        if p.word_count < 200 {
            self.thin += 1;
        }

        // Response speed.
        if p.response_time_ms < 500 {
            self.fast += 1;
        } else if p.response_time_ms < 1000 {
            self.moderate += 1;
        } else {
            self.slow += 1;
        }

        // Social tags.
        let og = truthy(&p.og_title);
        let tw = truthy(&p.twitter_card);
        if og && tw {
            self.og_both += 1;
        } else if og || tw {
            self.og_partial += 1;
        } else {
            self.og_missing += 1;
        }

        // Images (image-level).
        self.img_total += p.images_total;
        self.img_missing += p.images_missing_alt;

        // Mobile.
        if p.has_viewport {
            self.viewport += 1;
        } else {
            self.no_viewport += 1;
        }

        // International.
        if !p.hreflang.is_empty() {
            self.with_hreflang += 1;
        }
    }

    /// Build the ordered breakdown cards. Card order, denominators and segment
    /// logic match the former client-side view exactly.
    pub fn finish(&self) -> Vec<Breakdown> {
        use Tone::*;
        let (n, html) = (self.n, self.html);
        let seg = |label: &str, count: usize, tone: Tone| Segment {
            label: label.to_string(),
            count,
            tone,
        };
        let mut cards = Vec::new();

        cards.push(Breakdown {
            title: "Indexability".into(),
            total: n,
            bars: vec![
                seg(
                    "Indexable",
                    html.saturating_sub(self.noindex + self.canonicalized),
                    Good,
                ),
                seg("Canonicalized", self.canonicalized, Warn),
                seg("Noindex", self.noindex, Bad),
                seg("Non-200", n.saturating_sub(html), Muted),
            ],
        });

        cards.push(Breakdown {
            title: "Canonical tags".into(),
            total: html,
            bars: vec![
                seg("Self-referencing", self.canon_self, Good),
                seg("To another URL", self.canon_other, Warn),
                seg("Missing", self.canon_missing, Bad),
            ],
        });

        cards.push(Breakdown {
            title: "Structured data".into(),
            total: html,
            bars: vec![
                seg(
                    "Valid",
                    self.with_schema.saturating_sub(self.invalid_jsonld),
                    Good,
                ),
                seg("Invalid JSON-LD", self.invalid_jsonld, Bad),
                seg("None", html.saturating_sub(self.with_schema), Muted),
            ],
        });

        cards.push(Breakdown {
            title: "Content".into(),
            total: html,
            bars: vec![
                seg(
                    "Unique",
                    html.saturating_sub(self.dupes + self.thin),
                    Good,
                ),
                seg("Thin (<200 words)", self.thin, Warn),
                seg("Duplicate", self.dupes, Bad),
            ],
        });

        cards.push(Breakdown {
            title: "HTTP status".into(),
            total: n,
            bars: vec![
                seg("2xx OK", self.s2, Good),
                seg("3xx redirect", self.s3, Warn),
                seg("4xx client error", self.s4, Bad),
                seg("5xx server error", self.s5, Critical),
            ],
        });

        cards.push(Breakdown {
            title: "Response speed".into(),
            total: html,
            bars: vec![
                seg("Fast (<500ms)", self.fast, Good),
                seg("Moderate (0.5–1s)", self.moderate, Warn),
                seg("Slow (>1s)", self.slow, Bad),
            ],
        });

        cards.push(Breakdown {
            title: "Crawl depth".into(),
            total: n,
            bars: vec![
                seg("Depth 0 (home)", self.d0, Info),
                seg("Depth 1", self.d1, Good),
                seg("Depth 2", self.d2, Warn),
                seg("Depth 3+", self.d3plus, Bad),
            ],
        });

        cards.push(Breakdown {
            title: "Security".into(),
            total: n,
            bars: vec![
                seg("HTTPS + HSTS", self.https_hsts, Good),
                seg("HTTPS only", self.https_only, Warn),
                seg("Mixed content / HTTP", self.insecure, Bad),
            ],
        });

        cards.push(Breakdown {
            title: "Social tags (Open Graph)".into(),
            total: html,
            bars: vec![
                seg("OG + Twitter card", self.og_both, Good),
                seg("Partial", self.og_partial, Warn),
                seg("Missing", self.og_missing, Bad),
            ],
        });

        // Image alt text — only when the crawl actually saw images.
        if self.img_total > 0 {
            cards.push(Breakdown {
                title: "Image alt text".into(),
                total: self.img_total,
                bars: vec![
                    seg(
                        "With alt text",
                        self.img_total.saturating_sub(self.img_missing),
                        Good,
                    ),
                    seg("Missing alt text", self.img_missing, Bad),
                ],
            });
        }

        cards.push(Breakdown {
            title: "Mobile friendly".into(),
            total: html,
            bars: vec![
                seg("Has viewport", self.viewport, Good),
                seg("No viewport", self.no_viewport, Bad),
            ],
        });

        // International — only when hreflang is in play.
        if self.with_hreflang > 0 {
            cards.push(Breakdown {
                title: "International (hreflang)".into(),
                total: html,
                bars: vec![
                    seg("Has hreflang", self.with_hreflang, Good),
                    seg("None", html.saturating_sub(self.with_hreflang), Muted),
                ],
            });
        }

        cards
    }
}

/// Build breakdowns from an in-memory page slice (non-streaming callers such as
/// legacy full reports or tests). Streaming callers use [`InsightsAcc`] directly.
pub fn build(pages: &[Page]) -> Vec<Breakdown> {
    let mut acc = InsightsAcc::default();
    for p in pages {
        acc.add(p);
    }
    acc.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Page;

    fn page(url: &str, status: u16) -> Page {
        let mut p = Page::default();
        p.url = url.to_string();
        p.final_url = url.to_string();
        p.status = status;
        p
    }

    fn card<'a>(cards: &'a [Breakdown], title: &str) -> &'a Breakdown {
        cards.iter().find(|c| c.title == title).expect("card exists")
    }

    fn count(card: &Breakdown, label: &str) -> usize {
        card.bars
            .iter()
            .find(|b| b.label == label)
            .map(|b| b.count)
            .unwrap_or(0)
    }

    #[test]
    fn status_bands_and_totals() {
        let pages = vec![
            page("https://a.com/", 200),
            page("https://a.com/x", 200),
            page("https://a.com/gone", 404),
            page("https://a.com/redir", 301),
        ];
        let cards = build(&pages);
        let status = card(&cards, "HTTP status");
        assert_eq!(status.total, 4);
        assert_eq!(count(status, "2xx OK"), 2);
        assert_eq!(count(status, "3xx redirect"), 1);
        assert_eq!(count(status, "4xx client error"), 1);
        // Indexability denominator is all pages; Non-200 = 2.
        let idx = card(&cards, "Indexability");
        assert_eq!(idx.total, 4);
        assert_eq!(count(idx, "Non-200"), 2);
    }

    #[test]
    fn security_uses_final_url_and_mixed_content() {
        let mut secure = page("https://a.com/", 200);
        secure.hsts = true;
        let mut plain = page("http://a.com/http", 200);
        plain.final_url = "http://a.com/http".into();
        let mut mixed = page("https://a.com/mixed", 200);
        mixed.mixed_content = 3;
        let cards = build(&vec![secure, plain, mixed]);
        let sec = card(&cards, "Security");
        assert_eq!(count(sec, "HTTPS + HSTS"), 1);
        assert_eq!(count(sec, "Mixed content / HTTP"), 2); // the http page + the mixed one
    }

    #[test]
    fn conditional_cards_hidden_when_empty() {
        let cards = build(&vec![page("https://a.com/", 200)]);
        assert!(cards.iter().all(|c| c.title != "Image alt text"));
        assert!(cards.iter().all(|c| c.title != "International (hreflang)"));
    }

    #[test]
    fn streaming_matches_batch() {
        let pages = vec![
            page("https://a.com/", 200),
            page("https://a.com/gone", 500),
        ];
        let mut acc = InsightsAcc::default();
        for p in &pages {
            acc.add(p);
        }
        assert_eq!(acc.finish(), build(&pages));
    }
}
