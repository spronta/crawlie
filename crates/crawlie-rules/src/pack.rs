//! A [`RulePack`] is an ordered set of rules plus the evaluator that turns a
//! page's text into an explainable [`Ledger`] — a transparent list of which
//! rules fired and why, not an opaque score.

use crate::check::{CheckFinding, CheckRule, PageFacts};
use crate::rule::{Hit, Rule};
use serde::Serialize;

/// A named, version-controllable collection of rules. Loaded from a `.crawlie`
/// file (see [`crate::parse`]) or constructed in Rust.
#[derive(Debug, Clone)]
pub struct RulePack {
    pub name: String,
    /// Content rules (phrase/regex/metric) scored into a [`Ledger`].
    pub rules: Vec<Rule>,
    /// Custom audit checks emitting per-page findings (see [`crate::check`]).
    pub checks: Vec<CheckRule>,
}

/// The guidance a check carries into a report — the custom-rule counterpart of
/// crawlie-core's built-in knowledge entries.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInfo {
    pub rule: String,
    pub title: String,
    pub severity: &'static str,
    pub why: String,
    pub how_to_fix: String,
    pub impact: String,
}

/// The result of evaluating a pack against one page of text.
///
/// The `score` is just the sum of the `hits`' points — fully reconstructable
/// from the evidence, so nothing is hidden. A writer can act on every point.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    /// The pack that produced this ledger.
    pub pack: String,
    /// Total weighted score (higher = more slop / more violations).
    pub score: f64,
    /// Every rule that fired, in pack order, with its evidence.
    pub hits: Vec<Hit>,
}

impl Ledger {
    /// `true` if the score is at or above `threshold` (a failing page).
    pub fn fails(&self, threshold: f64) -> bool {
        self.score >= threshold
    }
}

impl RulePack {
    pub fn new(name: impl Into<String>, rules: Vec<Rule>) -> Self {
        Self {
            name: name.into(),
            rules,
            checks: Vec::new(),
        }
    }

    pub fn with_checks(name: impl Into<String>, rules: Vec<Rule>, checks: Vec<CheckRule>) -> Self {
        Self {
            name: name.into(),
            rules,
            checks,
        }
    }

    /// Run every custom audit check against one page's facts, in declaration
    /// order. Pure and deterministic, like [`RulePack::evaluate`].
    pub fn check_page(&self, facts: &PageFacts) -> Vec<CheckFinding> {
        self.checks
            .iter()
            .filter_map(|c| c.evaluate(facts))
            .collect()
    }

    /// The report-embeddable guidance for every check in this pack.
    pub fn check_infos(&self) -> Vec<CheckInfo> {
        self.checks
            .iter()
            .map(|c| CheckInfo {
                rule: c.name.clone(),
                title: c.title.clone(),
                severity: c.severity.as_str(),
                why: c.why.clone(),
                how_to_fix: c.fix.clone(),
                impact: c.impact.clone(),
            })
            .collect()
    }

    /// Evaluate every rule against `text`, in declaration order. Pure and
    /// deterministic: the same text and pack always yield the same ledger.
    pub fn evaluate(&self, text: &str) -> Ledger {
        let mut hits = Vec::new();
        let mut score = 0.0;
        for rule in &self.rules {
            if let Some(hit) = rule.evaluate(text) {
                score += hit.points;
                hits.push(hit);
            }
        }
        Ledger {
            pack: self.name.clone(),
            score,
            hits,
        }
    }
}
