//! Offline tests for the parser and audit rules (no network required).

use crawlie_core::parse::{parse_html, same_site};
use crawlie_core::types::*;
use std::collections::HashMap;
use url::Url;

const HTML: &str = r##"
<!doctype html>
<html lang="en">
  <head>
    <title>  Example   Page  </title>
    <meta name="description" content="A short description.">
    <meta name="robots" content="NOINDEX, follow">
    <link rel="canonical" href="/canonical-target">
  </head>
  <body>
    <h1>Main Heading</h1>
    <h2>Sub</h2><h2>Sub two</h2>
    <p>one two three four five</p>
    <img src="a.png" alt="described">
    <img src="b.png">
    <a href="/about">About</a>
    <a href="/about#team">About anchor (dup)</a>
    <a href="https://other.com/x">External</a>
    <a href="mailto:hi@example.com">Mail</a>
    <a href="#top">Frag</a>
  </body>
</html>
"##;

fn parsed() -> crawlie_core::parse::Parsed {
    let url = Url::parse("https://example.com/page").unwrap();
    parse_html(HTML, &url, "example.com")
}

#[test]
fn extracts_core_fields() {
    let p = parsed();
    assert_eq!(p.title.as_deref(), Some("Example Page")); // whitespace collapsed
    assert_eq!(p.meta_description.as_deref(), Some("A short description."));
    assert_eq!(p.h1, vec!["Main Heading".to_string()]);
    assert_eq!(p.h2_count, 2);
    assert_eq!(p.lang.as_deref(), Some("en"));
    assert_eq!(p.meta_robots.as_deref(), Some("noindex, follow")); // lowercased
    assert_eq!(
        p.canonical.as_deref(),
        Some("https://example.com/canonical-target")
    );
}

#[test]
fn classifies_and_dedupes_links() {
    let p = parsed();
    // /about and /about#team collapse to one internal link; external is separate;
    // mailto: and pure fragments are dropped.
    assert_eq!(
        p.internal_links,
        vec!["https://example.com/about".to_string()]
    );
    assert_eq!(p.external_links, vec!["https://other.com/x".to_string()]);
}

#[test]
fn counts_images_missing_alt() {
    let p = parsed();
    assert_eq!(p.images_total, 2);
    assert_eq!(p.images_missing_alt, 1);
}

#[test]
fn www_and_apex_are_same_site() {
    assert!(same_site("example.com", "www.example.com"));
    assert!(same_site("www.example.com", "example.com"));
    assert!(!same_site("example.com", "evil.com"));
}

// ---- audit ----

fn ok_page(url: &str) -> Page {
    Page {
        url: url.into(),
        final_url: url.into(),
        status: 200,
        redirect_chain: vec![],
        content_type: Some("text/html".into()),
        response_time_ms: 100,
        size_bytes: 1000,
        depth: 1,
        server: None,
        content_encoding: Some("gzip".into()),
        cache_control: None,
        x_robots_tag: None,
        hsts: true,
        title: Some("A perfectly reasonable page title here".into()),
        meta_description: Some("A meta description that is comfortably within the recommended length range for snippets.".into()),
        h1: vec!["Heading".into()],
        h2_count: 1,
        h3_count: 1,
        word_count: 500,
        text_ratio: 0.4,
        canonical: Some(url.into()),
        meta_robots: None,
        lang: Some("en".into()),
        has_viewport: true,
        indexable: true,
        indexability: None,
        canonicalized: false,
        images_total: 1,
        images_missing_alt: 0,
        internal_links: vec![],
        external_links: vec![],
        inlinks: 3,
        og_title: Some("OG".into()),
        og_image: Some("https://example.com/og.png".into()),
        twitter_card: Some("summary".into()),
        schema_types: vec!["Article".into()],
        hreflang: vec![],
        mixed_content: 0,
        geo: GeoSignals {
            semantic_html: true,
            structured_data: true,
            has_author: true,
            has_date: true,
            faq_schema: false,
            question_headings: 1,
            structured_blocks: 2,
            answerable: true,
            score: 84,
        },
        content_hash: None,
        duplicate_of: None,
        error: None,
    }
}

fn rules(issues: &[Issue]) -> Vec<&str> {
    issues.iter().map(|i| i.rule.as_str()).collect()
}

#[test]
fn audit_flags_a_broken_page() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut bad = ok_page("https://example.com/bad");
    bad.title = None;
    bad.meta_description = None;
    bad.h1 = vec![];
    bad.canonical = None;
    bad.word_count = 10;
    bad.images_total = 3;
    bad.images_missing_alt = 2;

    let status_map = HashMap::new();
    let issues = crawlie_core::audit::audit(&[bad], &status_map, &[], &seed);
    let r = rules(&issues);
    for expected in [
        "title-missing",
        "description-missing",
        "h1-missing",
        "canonical-missing",
        "thin-content",
        "image-missing-alt",
    ] {
        assert!(r.contains(&expected), "expected rule {expected} in {r:?}");
    }
}

#[test]
fn audit_detects_duplicate_titles_and_broken_links() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut a = ok_page("https://example.com/a");
    let mut b = ok_page("https://example.com/b");
    a.title = Some("Same Title On Both Pages Here".into());
    b.title = Some("Same Title On Both Pages Here".into());
    a.external_links = vec!["https://dead.example/404".into()];

    let mut status_map = HashMap::new();
    status_map.insert("https://dead.example/404".to_string(), 404u16);

    let issues = crawlie_core::audit::audit(&[a, b], &status_map, &[], &seed);
    let r = rules(&issues);
    assert!(r.contains(&"title-duplicate"), "missing dup title in {r:?}");
    assert!(r.contains(&"broken-link"), "missing broken link in {r:?}");
}

#[test]
fn audit_is_quiet_on_a_clean_page() {
    let seed = Url::parse("https://example.com/").unwrap();
    let page = ok_page("https://example.com/clean");
    let issues = crawlie_core::audit::audit(&[page], &HashMap::new(), &[], &seed);
    // A clean, AI-ready page should raise no problems — only the positive
    // `geo-ready` signal (Severity::Good) is allowed.
    let problems: Vec<&str> = issues
        .iter()
        .filter(|i| i.severity != Severity::Good)
        .map(|i| i.rule.as_str())
        .collect();
    assert!(
        problems.is_empty(),
        "expected no problems, got {problems:?}"
    );
    assert!(
        rules(&issues).contains(&"geo-ready"),
        "expected geo-ready good signal"
    );
}
