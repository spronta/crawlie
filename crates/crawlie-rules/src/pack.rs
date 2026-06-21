//! A [`RulePack`] is an ordered set of rules plus the evaluator that turns a
//! page's text into an explainable [`Ledger`] — a transparent list of which
//! rules fired and why, not an opaque score.

use crate::rule::{Hit, Rule};
use serde::Serialize;

/// A named, version-controllable collection of rules. Loaded from a `.crawlie`
/// file (see [`crate::parse`]) or constructed in Rust.
#[derive(Debug, Clone)]
pub struct RulePack {
    pub name: String,
    pub rules: Vec<Rule>,
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
        }
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
