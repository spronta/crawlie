//! Scoring: a per-page GEO (Generative Engine Optimization) readiness score and
//! an overall site health score. Both are 0–100 and intentionally explainable.

use crate::types::{Category, Issue, Page, Severity};

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
