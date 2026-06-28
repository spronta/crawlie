//! Scoring: a per-page GEO (Generative Engine Optimization) readiness score and
//! an overall site health score. Both are 0–100 and intentionally explainable.

use crate::types::{
    Category, CrawlResult, GeoGaps, Issue, LinkGraph, LinkNode, Page, Severity,
};
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
    pagerank(&out)
}

/// Assemble the internal-link graph from finished pages: a node per page, a
/// directed edge per resolved internal link, plus structure analytics (orphans,
/// dead-ends, reciprocity, top hubs/authorities). Uses the same URL resolution
/// as [`link_scores`], so the edges match the PageRank adjacency.
pub fn build_link_graph(pages: &[Page]) -> LinkGraph {
    let n = pages.len();
    if n == 0 {
        return LinkGraph::default();
    }
    let mut idx: HashMap<String, usize> = HashMap::new();
    for (i, p) in pages.iter().enumerate() {
        idx.entry(norm(&p.final_url)).or_insert(i);
        idx.entry(norm(&p.url)).or_insert(i);
    }
    // Resolved adjacency (dedup, no self-loops) — same shape PageRank uses.
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, p) in pages.iter().enumerate() {
        let mut seen = HashSet::new();
        for l in &p.internal_links {
            if let Some(&j) = idx.get(&norm(l)) {
                if j != i && seen.insert(j) {
                    adj[i].push(j);
                }
            }
        }
    }
    let mut edge_set: HashSet<(usize, usize)> = HashSet::new();
    let mut edges: Vec<[u32; 2]> = Vec::new();
    for (i, outs) in adj.iter().enumerate() {
        for &j in outs {
            edge_set.insert((i, j));
            edges.push([i as u32, j as u32]);
        }
    }
    let reciprocal_pairs = edge_set
        .iter()
        .filter(|&&(i, j)| i < j && edge_set.contains(&(j, i)))
        .count();

    let mut nodes: Vec<LinkNode> = Vec::with_capacity(n);
    let (mut orphans, mut dead_ends, mut max_depth, mut total_out) = (0, 0, 0, 0usize);
    for (i, p) in pages.iter().enumerate() {
        let outlinks = adj[i].len();
        total_out += outlinks;
        let orphan = p.depth > 0 && p.inlinks == 0;
        let dead_end = p.status == 200 && p.indexable && p.internal_links.is_empty();
        orphans += orphan as usize;
        dead_ends += dead_end as usize;
        max_depth = max_depth.max(p.depth);
        nodes.push(LinkNode {
            url: p.final_url.clone(),
            depth: p.depth,
            inlinks: p.inlinks,
            outlinks,
            link_score: p.link_score,
            indexable: p.indexable,
            status: p.status,
            orphan,
            dead_end,
        });
    }

    let mut top_authorities: Vec<u32> = (0..n as u32).collect();
    top_authorities.sort_by(|&a, &b| {
        nodes[b as usize]
            .link_score
            .partial_cmp(&nodes[a as usize].link_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    top_authorities.truncate(10);
    let mut top_hubs: Vec<u32> = (0..n as u32).collect();
    top_hubs.sort_by(|&a, &b| nodes[b as usize].outlinks.cmp(&nodes[a as usize].outlinks));
    top_hubs.truncate(10);

    LinkGraph {
        nodes,
        edges,
        orphans,
        dead_ends,
        max_depth,
        avg_outlinks: total_out as f32 / n as f32,
        reciprocal_pairs,
        top_authorities,
        top_hubs,
    }
}

/// PageRank over an explicit adjacency list (`adj[i]` = the page indices that
/// page `i` links to). Returned normalized so the top page scores 100, index-
/// aligned with `adj`. Shared by the in-memory crawl and the streaming crawl,
/// which builds the same adjacency from an on-disk edge graph.
pub fn pagerank(adj: &[Vec<usize>]) -> Vec<f32> {
    let n = adj.len();
    if n == 0 {
        return Vec::new();
    }
    let damping = 0.85f32;
    let mut rank = vec![1.0f32 / n as f32; n];
    for _ in 0..40 {
        let mut next = vec![(1.0 - damping) / n as f32; n];
        let mut dangling = 0.0f32;
        for i in 0..n {
            if adj[i].is_empty() {
                dangling += rank[i];
            } else {
                let share = damping * rank[i] / adj[i].len() as f32;
                for &j in &adj[i] {
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
    health_score_n(pages.len(), issues)
}

/// Health score from a page *count* rather than the page slice — so the
/// streaming crawl can score a crawl it never holds fully in memory.
pub fn health_score_n(page_count: usize, issues: &[Issue]) -> u8 {
    let n = page_count.max(1) as f32;
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

/// Recompute every derived score (per-page GEO/SEO/link scores and the site
/// scores) from the stored signals and issues. Used when loading a saved report
/// so older reports — whose scores predate a scoring fix — self-heal without a
/// re-crawl. Cheap and idempotent.
pub fn recompute(result: &mut CrawlResult) {
    let link = link_scores(&result.pages);
    for (i, p) in result.pages.iter_mut().enumerate() {
        p.link_score = link.get(i).copied().unwrap_or(0.0);
        p.geo.score = geo_score(p);
    }
    let seo = page_seo_scores(&result.pages, &result.issues);
    for (i, p) in result.pages.iter_mut().enumerate() {
        p.seo_score = seo.get(i).copied().unwrap_or(0);
    }
    result.summary.geo_score = site_geo_score(&result.pages);
    result.summary.health_score = health_score(&result.pages, &result.issues);
    result.link_graph = build_link_graph(&result.pages);
}

/// Count how many indexable HTML pages lack each GEO signal, so agents get the
/// aggregate ("82 of 86 pages missing authorship") without computing it.
pub fn geo_gaps(pages: &[Page]) -> GeoGaps {
    let mut g = GeoGaps::default();
    for p in pages
        .iter()
        .filter(|p| p.status == 200 && p.indexable && p.word_count > 50)
    {
        g.pages += 1;
        if !p.geo.has_author {
            g.missing_author += 1;
        }
        if !p.geo.has_date {
            g.missing_date += 1;
        }
        if !p.geo.structured_data {
            g.no_structured_data += 1;
        }
        if !p.geo.semantic_html {
            g.no_semantic_html += 1;
        }
        if !p.geo.answerable {
            g.not_answerable += 1;
        }
        if p.geo.question_headings == 0 {
            g.no_question_headings += 1;
        }
        if p.word_count < 300 {
            g.thin += 1;
        }
    }
    g
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
