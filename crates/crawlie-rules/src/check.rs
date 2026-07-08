//! Custom audit checks — the fourth rule kind.
//!
//! Where phrase/regex/metric rules score *content*, a [`CheckRule`] asserts a
//! *page fact* ("every /products/ page must declare Product schema") and emits
//! a real audit finding with its own severity and how-to-fix guidance, so
//! agency/site standards appear in crawl reports exactly like crawlie's
//! built-in rules. Same design contract as the rest of the crate: declarative,
//! deterministic, no user code executes.
//!
//! ```text
//! check_rule("brand-in-title",
//!     title    = "Title missing 'Acme'",
//!     severity = "warning",
//!     on       = "/products/*",
//!     require  = field("title", contains = "Acme"),
//!     why      = "Brand terms in product titles are part of the SERP strategy.",
//!     fix      = "Append ' | Acme' via the product title template.",
//! )
//! ```

use serde::Serialize;

/// Finding severity, mirroring crawlie-core's audit severities (minus `good`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckSeverity {
    Error,
    Warning,
    Notice,
}

impl CheckSeverity {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "error" => Some(Self::Error),
            "warning" => Some(Self::Warning),
            "notice" => Some(Self::Notice),
            _ => None,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Notice => "notice",
        }
    }
}

/// A text field of the page a predicate can look at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Title,
    Description,
    H1,
    Text,
    Canonical,
    Lang,
    Url,
}

impl Field {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "title" => Some(Self::Title),
            "description" => Some(Self::Description),
            "h1" => Some(Self::H1),
            "text" | "body" => Some(Self::Text),
            "canonical" => Some(Self::Canonical),
            "lang" => Some(Self::Lang),
            "url" => Some(Self::Url),
            "word_count" | "words" => None, // numeric — handled separately
            _ => None,
        }
    }
    fn label(&self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Description => "meta description",
            Self::H1 => "H1",
            Self::Text => "page text",
            Self::Canonical => "canonical",
            Self::Lang => "lang",
            Self::Url => "URL",
        }
    }
}

/// A numeric fact of the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumField {
    WordCount,
    ImagesTotal,
    ImagesMissingAlt,
    Inlinks,
}

impl NumField {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "word_count" | "words" => Some(Self::WordCount),
            "images" => Some(Self::ImagesTotal),
            "images_missing_alt" => Some(Self::ImagesMissingAlt),
            "inlinks" => Some(Self::Inlinks),
            _ => None,
        }
    }
    fn label(&self) -> &'static str {
        match self {
            Self::WordCount => "word count",
            Self::ImagesTotal => "image count",
            Self::ImagesMissingAlt => "images missing alt",
            Self::Inlinks => "inlinks",
        }
    }
}

/// What a check asserts about a page. Every variant is a pure function of
/// [`PageFacts`].
#[derive(Debug, Clone)]
pub enum Predicate {
    /// The field exists and is non-empty.
    FieldPresent(Field),
    /// The field contains `needle` (case-insensitive).
    FieldContains(Field, String),
    /// The field matches the regex.
    FieldMatches(Field, regex::Regex),
    /// The numeric fact is at least `n`.
    NumMin(NumField, f64),
    /// The numeric fact is at most `n`.
    NumMax(NumField, f64),
    /// The page declares this schema.org `@type`.
    Schema(String),
    /// The page hyperlinks to a URL containing this fragment (host or path).
    LinksTo(String),
    /// The named custom extraction produced at least one value.
    Extraction(String),
}

/// The page data checks evaluate against. Callers (the crawler container, the
/// CLI) build this from their page type; the crate stays dependency-free.
#[derive(Debug, Clone, Default)]
pub struct PageFacts<'a> {
    pub url: &'a str,
    /// URL path (with leading slash), used for `on = "..."` scoping.
    pub path: &'a str,
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub h1: Option<&'a str>,
    pub text: Option<&'a str>,
    pub canonical: Option<&'a str>,
    pub lang: Option<&'a str>,
    pub word_count: f64,
    pub images_total: f64,
    pub images_missing_alt: f64,
    pub inlinks: f64,
    pub schema_types: &'a [String],
    /// All outgoing hyperlinks (internal + external).
    pub links: &'a [String],
    /// Names of custom extractions that produced at least one value.
    pub extraction_names: &'a [String],
}

impl Predicate {
    fn field_value<'a>(facts: &'a PageFacts, f: Field) -> Option<&'a str> {
        match f {
            Field::Title => facts.title,
            Field::Description => facts.description,
            Field::H1 => facts.h1,
            Field::Text => facts.text,
            Field::Canonical => facts.canonical,
            Field::Lang => facts.lang,
            Field::Url => Some(facts.url),
        }
    }

    fn num_value(facts: &PageFacts, f: NumField) -> f64 {
        match f {
            NumField::WordCount => facts.word_count,
            NumField::ImagesTotal => facts.images_total,
            NumField::ImagesMissingAlt => facts.images_missing_alt,
            NumField::Inlinks => facts.inlinks,
        }
    }

    /// Whether the predicate holds for this page.
    pub fn holds(&self, facts: &PageFacts) -> bool {
        match self {
            Predicate::FieldPresent(f) => Self::field_value(facts, *f)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false),
            Predicate::FieldContains(f, needle) => Self::field_value(facts, *f)
                .map(|v| v.to_lowercase().contains(&needle.to_lowercase()))
                .unwrap_or(false),
            Predicate::FieldMatches(f, re) => Self::field_value(facts, *f)
                .map(|v| re.is_match(v))
                .unwrap_or(false),
            Predicate::NumMin(f, n) => Self::num_value(facts, *f) >= *n,
            Predicate::NumMax(f, n) => Self::num_value(facts, *f) <= *n,
            Predicate::Schema(t) => facts.schema_types.iter().any(|s| s.eq_ignore_ascii_case(t)),
            Predicate::LinksTo(frag) => {
                let frag = frag.to_lowercase();
                facts.links.iter().any(|l| l.to_lowercase().contains(&frag))
            }
            Predicate::Extraction(name) => facts.extraction_names.iter().any(|n| n == name),
        }
    }

    /// Human explanation of the *expected* state ("title contains \"Acme\"").
    fn describe(&self) -> String {
        match self {
            Predicate::FieldPresent(f) => format!("{} is present", f.label()),
            Predicate::FieldContains(f, s) => format!("{} contains \"{s}\"", f.label()),
            Predicate::FieldMatches(f, re) => format!("{} matches /{re}/", f.label()),
            Predicate::NumMin(f, n) => format!("{} ≥ {n}", f.label()),
            Predicate::NumMax(f, n) => format!("{} ≤ {n}", f.label()),
            Predicate::Schema(t) => format!("{t} schema is present"),
            Predicate::LinksTo(s) => format!("page links to \"{s}\""),
            Predicate::Extraction(n) => format!("extraction \"{n}\" matched"),
        }
    }
}

/// One custom audit check.
#[derive(Debug, Clone)]
pub struct CheckRule {
    /// Stable rule id (unique within the pack), e.g. `brand-in-title`.
    pub name: String,
    /// Human title shown in the report; defaults to the prettified name.
    pub title: String,
    pub severity: CheckSeverity,
    /// URL-path scope glob (`*` = any run); `None` = every page.
    pub on: Option<String>,
    pub predicate: Predicate,
    /// `true` = `forbid` (finding when the predicate HOLDS);
    /// `false` = `require` (finding when it does NOT hold).
    pub forbid: bool,
    pub why: String,
    pub fix: String,
    pub impact: String,
}

/// A check firing on one page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckFinding {
    pub rule: String,
    pub title: String,
    pub severity: CheckSeverity,
    pub url: String,
    pub detail: String,
}

/// Simple glob match (`*` = any run of characters); no `*` = substring.
/// Mirrors the crawler's include/exclude matching so scopes feel familiar.
fn glob_match(pattern: &str, text: &str) -> bool {
    if !pattern.contains('*') {
        return text.contains(pattern);
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut pos = 0usize;
    for (idx, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        match text[pos..].find(part) {
            // The first segment must anchor at the start (no leading `*`).
            Some(found) if idx > 0 || found == 0 => pos += found + part.len(),
            _ => return false,
        }
    }
    // A non-empty last segment with no trailing `*` must anchor at the end.
    if let Some(last) = parts.last() {
        if !last.is_empty() && !text.ends_with(last) {
            return false;
        }
    }
    true
}

impl CheckRule {
    /// Whether this check applies to the page at all (scope match).
    pub fn applies(&self, facts: &PageFacts) -> bool {
        match &self.on {
            Some(scope) => glob_match(scope, facts.path),
            None => true,
        }
    }

    /// Evaluate against one page; `Some(finding)` when the standard is violated.
    pub fn evaluate(&self, facts: &PageFacts) -> Option<CheckFinding> {
        if !self.applies(facts) {
            return None;
        }
        let holds = self.predicate.holds(facts);
        let violated = if self.forbid { holds } else { !holds };
        if !violated {
            return None;
        }
        let detail = if self.forbid {
            format!("forbidden: {}", self.predicate.describe())
        } else {
            format!("expected: {}", self.predicate.describe())
        };
        Some(CheckFinding {
            rule: self.name.clone(),
            title: self.title.clone(),
            severity: self.severity,
            url: facts.url.to_string(),
            detail,
        })
    }
}

/// Prettify a rule id into a default title: `brand-in-title` → "Brand in title".
pub fn default_title(name: &str) -> String {
    let mut s: String = name.replace(['-', '_'], " ");
    if let Some(first) = s.get(0..1) {
        let upper = first.to_uppercase();
        s.replace_range(0..1, &upper);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts<'a>(
        path: &'a str,
        title: Option<&'a str>,
        schema: &'a [String],
        links: &'a [String],
    ) -> PageFacts<'a> {
        PageFacts {
            url: path,
            path,
            title,
            schema_types: schema,
            links,
            word_count: 500.0,
            ..Default::default()
        }
    }

    #[test]
    fn require_fires_when_predicate_fails() {
        let rule = CheckRule {
            name: "brand-in-title".into(),
            title: "Title missing Acme".into(),
            severity: CheckSeverity::Warning,
            on: Some("/products/*".into()),
            predicate: Predicate::FieldContains(Field::Title, "Acme".into()),
            forbid: false,
            why: String::new(),
            fix: String::new(),
            impact: String::new(),
        };
        let bad = facts("/products/widget", Some("Widget 3000"), &[], &[]);
        let good = facts("/products/widget", Some("Widget 3000 | Acme"), &[], &[]);
        let out_of_scope = facts("/blog/post", Some("Widget 3000"), &[], &[]);
        assert!(rule.evaluate(&bad).is_some());
        assert!(rule.evaluate(&good).is_none());
        assert!(rule.evaluate(&out_of_scope).is_none());
        let f = rule.evaluate(&bad).unwrap();
        assert!(f.detail.contains("title contains \"Acme\""), "{}", f.detail);
    }

    #[test]
    fn forbid_fires_when_predicate_holds() {
        let rule = CheckRule {
            name: "staging-links".into(),
            title: "Links to staging".into(),
            severity: CheckSeverity::Error,
            on: None,
            predicate: Predicate::LinksTo("staging.acme.com".into()),
            forbid: true,
            why: String::new(),
            fix: String::new(),
            impact: String::new(),
        };
        let links = vec!["https://staging.acme.com/page".to_string()];
        let bad = facts("/", None, &[], &links);
        let clean = facts("/", None, &[], &[]);
        assert!(rule.evaluate(&bad).is_some());
        assert!(rule.evaluate(&clean).is_none());
    }

    #[test]
    fn schema_and_numeric_predicates() {
        let schema = vec!["Product".to_string()];
        let with = facts("/p/1", None, &schema, &[]);
        let without = facts("/p/2", None, &[], &[]);
        assert!(Predicate::Schema("product".into()).holds(&with));
        assert!(!Predicate::Schema("Product".into()).holds(&without));
        assert!(Predicate::NumMin(NumField::WordCount, 300.0).holds(&with));
        assert!(!Predicate::NumMin(NumField::WordCount, 900.0).holds(&with));
    }

    #[test]
    fn glob_scopes_anchor_correctly() {
        assert!(glob_match("/products/*", "/products/widget"));
        assert!(!glob_match("/products/*", "/blog/products-of-2026"));
        assert!(glob_match("*", "/anything"));
        assert!(glob_match("/blog", "/blog/post")); // substring form
    }

    #[test]
    fn default_titles_read_well() {
        assert_eq!(default_title("brand-in-title"), "Brand in title");
        assert_eq!(default_title("ga4_missing"), "Ga4 missing");
    }
}
