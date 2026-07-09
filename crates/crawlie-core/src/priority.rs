//! Turn a flat list of issues into a prioritized action plan: the highest-impact
//! fixes first, each with the guidance from the knowledge base. This is what
//! turns "here are 200 problems" into "do these 5 things next".

use crate::knowledge::rule_info;
use crate::types::{Category, Fix, Issue, IssueGroup, Severity};
use std::collections::HashMap;

fn rank(s: Severity) -> u8 {
    match s {
        Severity::Error => 3,
        Severity::Warning => 2,
        Severity::Notice => 1,
        Severity::Good => 0,
    }
}

/// Collapse issues to one entry per rule (most severe / most numerous first),
/// each with up to `sample_limit` affected URLs. The compact shape for agents.
pub fn group_issues(issues: &[Issue], sample_limit: usize) -> Vec<IssueGroup> {
    struct G {
        title: String,
        category: Category,
        severity: Severity,
        count: usize,
        urls: Vec<String>,
    }
    let mut map: HashMap<String, G> = HashMap::new();
    for i in issues.iter().filter(|i| i.severity != Severity::Good) {
        let g = map.entry(i.rule.clone()).or_insert(G {
            title: i.title.clone(),
            category: i.category,
            severity: i.severity,
            count: 0,
            urls: Vec::new(),
        });
        g.count += 1;
        if g.urls.len() < sample_limit {
            g.urls.push(i.url.clone());
        }
    }
    let mut out: Vec<IssueGroup> = map
        .into_iter()
        .map(|(rule, g)| IssueGroup {
            rule,
            title: g.title,
            category: g.category,
            severity: g.severity,
            count: g.count,
            sample_urls: g.urls,
        })
        .collect();
    out.sort_by(|a, b| {
        rank(b.severity)
            .cmp(&rank(a.severity))
            .then(b.count.cmp(&a.count))
    });
    out
}

/// Collapse issues into per-rule rollups carrying the **true count** plus up
/// to `sample_limit` full sample findings per rule. This is what lean
/// (out-of-core) reports ship instead of the complete issue list, so a crawl
/// with millions of findings still renders exact per-rule numbers.
pub fn rollup_issues(issues: &[Issue], sample_limit: usize) -> Vec<crate::types::IssueRollup> {
    let mut order: Vec<String> = Vec::new();
    let mut map: HashMap<String, crate::types::IssueRollup> = HashMap::new();
    for i in issues {
        let r = map.entry(i.rule.clone()).or_insert_with(|| {
            order.push(i.rule.clone());
            crate::types::IssueRollup {
                rule: i.rule.clone(),
                title: i.title.clone(),
                category: i.category,
                severity: i.severity,
                count: 0,
                sample: Vec::new(),
            }
        });
        r.count += 1;
        if r.sample.len() < sample_limit {
            r.sample.push(i.clone());
        }
    }
    let mut out: Vec<crate::types::IssueRollup> = order
        .into_iter()
        .filter_map(|rule| map.remove(&rule))
        .collect();
    out.sort_by(|a, b| {
        rank(b.severity)
            .cmp(&rank(a.severity))
            .then(b.count.cmp(&a.count))
    });
    out
}

/// `top_fixes`, optionally scoped to a single category (e.g. just GEO fixes).
pub fn top_fixes_filtered(issues: &[Issue], category: Option<Category>, limit: usize) -> Vec<Fix> {
    match category {
        Some(c) => {
            let filtered: Vec<Issue> = issues.iter().filter(|i| i.category == c).cloned().collect();
            top_fixes(&filtered, limit)
        }
        None => top_fixes(issues, limit),
    }
}

fn severity_weight(s: Severity) -> f32 {
    match s {
        Severity::Error => 5.0,
        Severity::Warning => 2.0,
        Severity::Notice => 0.6,
        Severity::Good => 0.0,
    }
}

/// The top `limit` recommended fixes, ranked by impact. Impact rewards severity
/// and breadth, but dampens runaway counts (a √ curve) so one critical error
/// outranks a hundred cosmetic notices.
pub fn top_fixes(issues: &[Issue], limit: usize) -> Vec<Fix> {
    struct Agg {
        title: String,
        category: Category,
        severity: Severity,
        count: usize,
    }
    let mut groups: HashMap<String, Agg> = HashMap::new();
    for i in issues.iter().filter(|i| i.severity != Severity::Good) {
        let e = groups.entry(i.rule.clone()).or_insert(Agg {
            title: i.title.clone(),
            category: i.category,
            severity: i.severity,
            count: 0,
        });
        e.count += 1;
    }

    let mut fixes: Vec<Fix> = groups
        .into_iter()
        .map(|(rule, a)| {
            let info = rule_info(&rule);
            let impact = severity_weight(a.severity) * (a.count as f32).sqrt();
            Fix {
                rule,
                title: a.title,
                category: a.category,
                severity: a.severity,
                count: a.count,
                impact,
                why: info.as_ref().map(|x| x.why.clone()).unwrap_or_default(),
                how_to_fix: info
                    .as_ref()
                    .map(|x| x.how_to_fix.clone())
                    .unwrap_or_default(),
            }
        })
        .collect();

    fixes.sort_by(|a, b| {
        b.impact
            .partial_cmp(&a.impact)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.count.cmp(&a.count))
    });
    fixes.truncate(limit);
    fixes
}
