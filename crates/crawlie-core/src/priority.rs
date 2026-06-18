//! Turn a flat list of issues into a prioritized action plan: the highest-impact
//! fixes first, each with the guidance from the knowledge base. This is what
//! turns "here are 200 problems" into "do these 5 things next".

use crate::knowledge::rule_info;
use crate::types::{Category, Fix, Issue, Severity};
use std::collections::HashMap;

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
