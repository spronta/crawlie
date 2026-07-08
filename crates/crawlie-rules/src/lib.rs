//! crawlie-rules — deterministic, editable, agent-writable content rule packs.
//!
//! This crate is the runtime for `.crawlie` rule packs: small files that detect
//! AI slop, brand drift, and tone problems in page text using nothing but
//! literal phrases, regexes, and deterministic statistics. No model is called
//! at runtime, so a pack:
//!
//! * **is deterministic** — same text + same pack ⇒ same result, every run;
//! * **is portable** — pure Rust, no async, no I/O, no clock, so the exact same
//!   pack compiles to a native binary (laptop / CI) *and* to `wasm32` (a
//!   Cloudflare Worker for Crawlie Cloud);
//! * **is editable & writable** — packs are plain text a human edits or an
//!   agent generates, then version-controls alongside the site;
//! * **explains itself** — evaluation yields a [`Ledger`] of exactly which
//!   rules fired and the evidence, never an opaque score.
//!
//! The intelligence lives at *authoring* time. Use an LLM to write the rules
//! from examples; run the rules deterministically forever.
//!
//! ```
//! use crawlie_rules::{load, default_pack};
//!
//! let pack = default_pack().unwrap();
//! let ledger = pack.evaluate(
//!     "In today's fast-paced world, unlock the power of our robust solution.",
//! );
//! assert!(ledger.score > 0.0);
//! assert!(!ledger.hits.is_empty());
//! ```

pub mod check;
pub mod pack;
pub mod parse;
pub mod resolve;
pub mod rule;
pub mod slop;
pub mod text;

pub use check::{CheckFinding, CheckRule, CheckSeverity, PageFacts, Predicate};
pub use pack::{CheckInfo, Ledger, RulePack};
pub use parse::{load, ParseError};
pub use resolve::{Origin, PackEntry, ResolveError, Resolved, Resolver};
pub use rule::{Comparator, Hit, Metric, Rule, RuleKind};
pub use slop::{default_pack, SLOP_DEFAULT_SRC};

#[cfg(test)]
mod tests {
    use super::*;

    const SLOPPY: &str = "In today's fast-paced world, it's important to note that our \
        cutting-edge, best-in-class solution will elevate your business to the next level. \
        Whether you're a startup or an enterprise, our robust solution delivers seamless \
        integration. Moreover, it is fast, reliable, and scalable. Furthermore, it is \
        powerful, flexible, and intuitive. Additionally, it unlocks the power of synergy.";

    const CLEAN: &str = "We built this in a weekend. It crawls your site and flags broken \
        links. Point it at a URL. It returns JSON. No account needed. The whole thing is \
        one binary you can drop into CI. If something looks wrong, open an issue — we read \
        every one. That's it.";

    #[test]
    fn builtin_pack_parses() {
        let pack = default_pack().expect("slop-default.crawlie must parse");
        assert!(pack.rules.len() >= 10, "expected the full default pack");
    }

    #[test]
    fn sloppy_scores_higher_than_clean() {
        let pack = default_pack().unwrap();
        let sloppy = pack.evaluate(SLOPPY).score;
        let clean = pack.evaluate(CLEAN).score;
        assert!(
            sloppy > clean + 4.0,
            "sloppy ({sloppy}) should clearly beat clean ({clean})"
        );
    }

    #[test]
    fn evaluation_is_deterministic() {
        let pack = default_pack().unwrap();
        let a = pack.evaluate(SLOPPY);
        let b = pack.evaluate(SLOPPY);
        assert_eq!(a.score, b.score);
        assert_eq!(a.hits.len(), b.hits.len());
    }

    #[test]
    fn hits_carry_actionable_evidence() {
        let pack = default_pack().unwrap();
        let ledger = pack.evaluate(SLOPPY);
        let cliches = ledger
            .hits
            .iter()
            .find(|h| h.rule == "ai-cliches")
            .expect("the cliché rule should fire");
        assert!(!cliches.evidence.is_empty());
        assert!(cliches
            .evidence
            .iter()
            .any(|e| e.contains("fast-paced world")));
    }

    #[test]
    fn editing_the_pack_changes_the_outcome() {
        // A user fork that only keeps one phrase rule scores lower than the full pack.
        let trimmed = load(
            "trimmed",
            "phrase_rule(\"x\", weight = 1, phrases = [\"unlock the power of\"])",
        )
        .unwrap();
        let full = default_pack().unwrap();
        assert!(trimmed.evaluate(SLOPPY).score < full.evaluate(SLOPPY).score);
    }

    #[test]
    fn parse_errors_report_location() {
        let err = load(
            "bad",
            "phrase_rule(\"x\", weight = 1, phrases = [\n  \"oops\"",
        )
        .unwrap_err();
        assert!(err.line >= 1);
        // serializable for agents
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("line"));
    }

    #[test]
    fn check_rules_parse_and_evaluate() {
        let pack = load(
            "acme",
            r#"
            # Content rule and audit checks living side by side.
            phrase_rule("cliches", weight = 2, phrases = ["unlock the power of"])

            check_rule("brand-in-title",
                title    = "Title missing 'Acme'",
                severity = "warning",
                on       = "/products/*",
                require  = field("title", contains = "Acme"),
                why      = "Brand terms drive branded SERPs.",
                fix      = "Append ' | Acme' in the title template.",
            )
            check_rule("staging-links",
                severity = "error",
                forbid   = links_to("staging.acme.com"),
            )
            check_rule("product-schema",
                on      = "/products/*",
                require = schema("Product"),
            )
            check_rule("min-words", require = field("word_count", min = 100))
            "#,
        )
        .unwrap();
        assert_eq!(pack.rules.len(), 1);
        assert_eq!(pack.checks.len(), 4);

        let links = vec!["https://staging.acme.com/x".to_string()];
        let facts = PageFacts {
            url: "https://acme.com/products/widget",
            path: "/products/widget",
            title: Some("Widget 3000"),
            word_count: 40.0,
            links: &links,
            ..Default::default()
        };
        let findings = pack.check_page(&facts);
        let rules: Vec<&str> = findings.iter().map(|f| f.rule.as_str()).collect();
        assert!(rules.contains(&"brand-in-title"), "{rules:?}");
        assert!(rules.contains(&"staging-links"));
        assert!(rules.contains(&"product-schema"));
        assert!(rules.contains(&"min-words"));

        // Default title prettifies; explicit title is kept; infos embed guidance.
        let infos = pack.check_infos();
        assert_eq!(infos[0].title, "Title missing 'Acme'");
        assert_eq!(infos[1].title, "Staging links");
        assert!(infos[0].how_to_fix.contains("title template"));

        // require/forbid validation errors are structured.
        assert!(load("bad", "check_rule(\"x\")").is_err());
    }

    #[test]
    fn custom_metric_rule_round_trips() {
        let pack = load(
            "m",
            "metric_rule(\"v\", weight = 5, metric = sentence_variance(), when = below(9999))",
        )
        .unwrap();
        // a near-infinite threshold guarantees the rule fires on any multi-sentence text
        let ledger = pack.evaluate("One. Two words here. Three words here now.");
        assert_eq!(ledger.score, 5.0);
    }
}
