//! Scoring: a per-page GEO (Generative Engine Optimization) readiness score and
//! an overall site health score. Both are 0–100 and intentionally explainable.

use crate::types::{Category, Issue, Page, Severity};
use std::collections::{HashMap, HashSet};
use url::Url;

fn norm(s: &str) -> String {
    match Url::parse(s) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => s.to_string(),
    }
}

/// Internal-link authority via PageRank, returned index-aligned with `pages` and
/// normalized so the most authoritative page scores 100.
pub fn link_scores(pages: &[Page]) -> Vec<f32> {
    let n = pages.len();
    if n == 0 {
        return Vec::new();
    }
    let mut idx: HashMap<String, usize> = HashMap::new();
    for (i, p) in pages.iter().enumerate() {
        idx.entry(norm(&p.final_url)).or_insert(i);
        idx.entry(norm(&p.url)).or_insert(i);
    }
    let mut out: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, p) in pages.iter().enumerate() {
        let mut seen = HashSet::new();
        for l in &p.internal_links {
            if let Some(&j) = idx.get(&norm(l)) {
                if j != i && seen.insert(j) {
                    out[i].push(j);
                }
            }
        }
    }
    let damping = 0.85f32;
    let mut rank = vec![1.0f32 / n as f32; n];
    for _ in 0..40 {
        let mut next = vec![(1.0 - damping) / n as f32; n];
        let mut dangling = 0.0f32;
        for i in 0..n {
            if out[i].is_empty() {
                dangling += rank[i];
            } else {
                let share = damping * rank[i] / out[i].len() as f32;
                for &j in &out[i] {
                    next[j] += share;
                }
            }
        }
        let spread = damping * dangling / n as f32;
        for v in next.iter_mut() {
            *v += spread;
        }
        rank = next;
    }
    let max = rank
        .iter()
        .cloned()
        .fold(0.0f32, f32::max)
        .max(f32::MIN_POSITIVE);
    rank.iter()
        .map(|r| (r / max * 100.0).clamp(0.0, 100.0))
        .collect()
}

/// Per-page SEO score (Yoast-style), index-aligned with `pages`. Each 200 page
/// starts at 100 and loses points for its own technical-SEO issues (errors hurt
/// most). GEO issues are excluded — they have their own score. Non-200 = 0.
pub fn page_seo_scores(pages: &[Page], issues: &[Issue]) -> Vec<u8> {
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
        *penalty.entry(norm(&i.url)).or_insert(0.0) += w;
    }
    pages
        .iter()
        .map(|p| {
            if p.status != 200 {
                return 0;
            }
            let pen = penalty.get(&norm(&p.url)).copied().unwrap_or(0.0);
            (100.0 - pen).clamp(0.0, 100.0).round() as u8
        })
        .collect()
}

/// GEO readiness for one page, 0–100. Only meaningful for indexable HTML pages;
/// returns 0 otherwise.
pub fn geo_score(p: &Page) -> u8 {
    if p.status != 200 {
        return 0;
    }
    let g = &p.geo;
    let mut score = 0u32;
    score += if g.structured_data { 20 } else { 0 };
    score += if g.semantic_html { 12 } else { 0 };
    score += if g.answerable { 18 } else { 0 };
    score += if g.has_author { 10 } else { 0 };
    score += if g.has_date { 8 } else { 0 };
    score += if g.faq_schema { 8 } else { 0 };
    score += if g.question_headings > 0 { 8 } else { 0 };
    score += if g.structured_blocks > 0 { 8 } else { 0 };
    score += if p.word_count >= 300 { 8 } else { 0 };
    score.min(100) as u8
}

/// Overall technical-SEO health, 0–100, from weighted issue density.
pub fn health_score(pages: &[Page], issues: &[Issue]) -> u8 {
    let n = pages.len().max(1) as f32;
    let mut weight = 0f32;
    // GEO has its own dedicated score; don't let it drag down technical health.
    for i in issues.iter().filter(|i| i.category != Category::Geo) {
        weight += match i.severity {
            Severity::Error => 3.0,
            Severity::Warning => 1.0,
            Severity::Notice => 0.25,
            Severity::Good => 0.0,
        };
    }
    let per_page = weight / n;
    let penalty = (per_page * 12.0).min(100.0);
    (100.0 - penalty).round().clamp(0.0, 100.0) as u8
}

/// Average GEO score across indexable HTML pages.
pub fn site_geo_score(pages: &[Page]) -> u8 {
    let scored: Vec<u8> = pages
        .iter()
        .filter(|p| p.status == 200 && p.indexable)
        .map(|p| p.geo.score)
        .collect();
    if scored.is_empty() {
        return 0;
    }
    (scored.iter().map(|&s| s as u32).sum::<u32>() / scored.len() as u32) as u8
}
