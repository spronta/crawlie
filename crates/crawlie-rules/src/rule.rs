//! The deterministic rule primitives.
//!
//! A rule pack is built from exactly three kinds of rule, in increasing power:
//!
//! * [`RuleKind::Phrase`] — a dictionary of literal phrases (the AI-cliché list).
//! * [`RuleKind::Regex`]  — a structural pattern (e.g. the "rule of three").
//! * [`RuleKind::Metric`] — a deterministic statistic compared to a threshold.
//!
//! None of them call a model. The intelligence is spent at *authoring* time
//! (a human or an agent decides which phrases/patterns/thresholds matter); at
//! *runtime* the rules are pure, fast, and explainable.

use crate::text;
use serde::Serialize;

/// How many times a single phrase/regex rule's weight can stack on one page.
/// Caps runaway scores on long pages while still rewarding repeated offenders.
const MATCH_CAP: usize = 3;

/// A deterministic statistic computed over a page's text.
#[derive(Debug, Clone, PartialEq)]
pub enum Metric {
    SentenceVariance,
    EmDashDensity,
    FillerRatio,
    TransitionRatio,
    LexicalDiversity,
    AdverbDensity,
    NgramRepetition(usize),
}

impl Metric {
    pub fn compute(&self, t: &str) -> f64 {
        match self {
            Metric::SentenceVariance => text::sentence_variance(t),
            Metric::EmDashDensity => text::char_density(t, '\u{2014}'),
            Metric::FillerRatio => text::word_set_ratio(t, text::FILLER_WORDS),
            Metric::TransitionRatio => text::word_set_ratio(t, text::TRANSITION_WORDS),
            Metric::LexicalDiversity => text::lexical_diversity(t),
            Metric::AdverbDensity => text::adverb_density(t),
            Metric::NgramRepetition(n) => text::ngram_repetition(t, *n),
        }
    }

    pub fn name(&self) -> String {
        match self {
            Metric::SentenceVariance => "sentence_variance".into(),
            Metric::EmDashDensity => "em_dash_density".into(),
            Metric::FillerRatio => "filler_ratio".into(),
            Metric::TransitionRatio => "transition_ratio".into(),
            Metric::LexicalDiversity => "lexical_diversity".into(),
            Metric::AdverbDensity => "adverb_density".into(),
            Metric::NgramRepetition(n) => format!("ngram_repetition({n})"),
        }
    }
}

/// A threshold a metric is tested against.
#[derive(Debug, Clone, PartialEq)]
pub enum Comparator {
    Below(f64),
    Above(f64),
    Between(f64, f64),
}

impl Comparator {
    pub fn crossed(&self, v: f64) -> bool {
        match *self {
            Comparator::Below(t) => v < t,
            Comparator::Above(t) => v > t,
            Comparator::Between(lo, hi) => v >= lo && v <= hi,
        }
    }

    pub fn describe(&self) -> String {
        match *self {
            Comparator::Below(t) => format!("below {t}"),
            Comparator::Above(t) => format!("above {t}"),
            Comparator::Between(lo, hi) => format!("between {lo} and {hi}"),
        }
    }
}

/// What a rule looks for.
#[derive(Debug, Clone)]
pub enum RuleKind {
    Phrase(Vec<String>),
    Regex(regex::Regex),
    Metric { metric: Metric, when: Comparator },
}

/// One named, weighted detector.
#[derive(Debug, Clone)]
pub struct Rule {
    pub name: String,
    pub weight: f64,
    pub kind: RuleKind,
}

/// A single rule firing on a page, with the evidence that triggered it.
/// Serializes to camelCase JSON for agents and dashboards.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// The rule that fired.
    pub rule: String,
    /// Weight contributed to the page's score.
    pub points: f64,
    /// Human + machine readable proof: the matched phrases, or the metric value.
    pub evidence: Vec<String>,
}

impl Rule {
    /// Evaluate this rule against `text`. Returns `None` if it did not fire.
    pub fn evaluate(&self, text: &str) -> Option<Hit> {
        match &self.kind {
            RuleKind::Phrase(phrases) => {
                let lower = text.to_ascii_lowercase();
                let mut evidence = Vec::new();
                let mut matches = 0usize;
                for p in phrases {
                    let pl = p.to_ascii_lowercase();
                    let c = lower.matches(&pl).count();
                    if c > 0 {
                        matches += c;
                        evidence.push(if c > 1 {
                            format!("\u{201c}{p}\u{201d} (\u{00d7}{c})")
                        } else {
                            format!("\u{201c}{p}\u{201d}")
                        });
                    }
                }
                if matches == 0 {
                    return None;
                }
                Some(Hit {
                    rule: self.name.clone(),
                    points: self.weight * matches.min(MATCH_CAP) as f64,
                    evidence,
                })
            }
            RuleKind::Regex(re) => {
                let found: Vec<String> = re
                    .find_iter(text)
                    .take(MATCH_CAP)
                    .map(|m| format!("\u{201c}{}\u{201d}", m.as_str().trim()))
                    .collect();
                let total = re.find_iter(text).count();
                if total == 0 {
                    return None;
                }
                Some(Hit {
                    rule: self.name.clone(),
                    points: self.weight * total.min(MATCH_CAP) as f64,
                    evidence: found,
                })
            }
            RuleKind::Metric { metric, when } => {
                let v = metric.compute(text);
                if !when.crossed(v) {
                    return None;
                }
                Some(Hit {
                    rule: self.name.clone(),
                    points: self.weight,
                    evidence: vec![format!(
                        "{} = {:.3} ({})",
                        metric.name(),
                        v,
                        when.describe()
                    )],
                })
            }
        }
    }
}
