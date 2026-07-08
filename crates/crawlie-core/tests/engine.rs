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
    parse_html(HTML, &url, "example.com", &[])
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
fn parses_markup_hygiene_signals() {
    let html = r##"<!doctype html>
<html>
  <head>
    <title>First</title><title>Second</title>
    <meta name="description" content="one"><meta name="description" content="two">
    <meta http-equiv="refresh" content="5; url=/new">
    <link rel="canonical" href="/a"><link rel="canonical" href="/b">
    <meta name="viewport" content="width=device-width"><meta name="viewport" content="width=1024">
  </head>
  <body>
    <h1>Page Not Found</h1>
    <p>lorem ipsum dolor sit amet and plenty more placeholder</p>
    <a href="/x">click here</a>
    <a href="/y" rel="nofollow">A fine descriptive anchor</a>
    <img src="a.png" alt="a">
    <form action="http://insecure.example/submit"><input type="text" aria-label="q"></form>
    <script src="//cdn.example/app.js"></script>
  </body>
</html>"##;
    let url = Url::parse("https://example.com/page").unwrap();
    let m = parse_html(html, &url, "example.com", &[]).markup;
    assert_eq!(m.title_count, 2);
    assert_eq!(m.meta_description_count, 2);
    assert_eq!(m.canonical_count, 2);
    assert!(m.canonical_conflict, "canonicals disagree");
    assert_eq!(m.viewport_count, 2);
    assert!(m.meta_refresh.as_deref().unwrap_or("").contains("url=/new"));
    assert!(!m.has_favicon);
    assert!(!m.has_charset);
    assert_eq!(m.generic_anchors, 1, "only 'click here' is generic");
    assert_eq!(m.nofollow_links, 1);
    assert!(m.form_to_http);
    assert_eq!(m.protocol_relative, 1);
    assert_eq!(m.imgs_no_dimensions, 1);
    assert!(m.soft404_phrase, "H1 says Page Not Found");
    assert!(m.lorem_ipsum);
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
        text: None,
        canonical: Some(url.into()),
        meta_robots: None,
        lang: Some("en".into()),
        has_viewport: true,
        rendered: false,
        pre_render_word_count: 500,
        render_diff: None,
        indexable: true,
        indexability: None,
        canonicalized: false,
        images_total: 1,
        images_missing_alt: 0,
        // A realistic page links out internally (so it isn't a structural dead end).
        internal_links: vec!["https://example.com/".into()],
        external_links: vec![],
        inlinks: 3,
        link_score: 50.0,
        seo_score: 100,
        og_title: Some("OG".into()),
        og_image: Some("https://example.com/og.png".into()),
        twitter_card: Some("summary".into()),
        schema_types: vec!["Article".into()],
        schema_validations: vec![],
        invalid_jsonld: 0,
        hreflang: vec![],
        mixed_content: 0,
        // Present headers / clean markup by default so header and markup rules
        // only fire when a test opts in.
        sec_headers: SecurityHeaders {
            csp: true,
            x_content_type_options: true,
            x_frame_options: true,
            referrer_policy: true,
        },
        markup: MarkupSignals {
            title_count: 1,
            meta_description_count: 1,
            canonical_count: 1,
            viewport_count: 1,
            has_favicon: true,
            has_charset: true,
            ..Default::default()
        },
        a11y: Default::default(),
        extractions: vec![],
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
        simhash: None,
        readability: None,
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
fn audit_flags_url_hygiene_and_variant_duplicates() {
    let seed = Url::parse("https://example.com/").unwrap();
    let ugly = ok_page("https://example.com/Blog_Posts//My%20Page?utm_source=x&page=2&sort=asc");
    // Case + trailing-slash variants of the same URL, crawled separately.
    let a = ok_page("https://example.com/dup");
    let mut b = ok_page("https://example.com/Dup");
    let mut c = ok_page("https://example.com/dup/");
    // Distinct content so only the URL rules fire on the variants.
    b.title = Some("A second, also perfectly reasonable title".into());
    b.h1 = vec!["Second Heading".into()];
    b.meta_description = Some(
        "Another meta description that is comfortably within the recommended length range.".into(),
    );
    c.title = Some("A third, also perfectly reasonable title".into());
    c.h1 = vec!["Third Heading".into()];
    c.meta_description = Some(
        "Yet another meta description comfortably within the recommended length range here.".into(),
    );
    let trap = ok_page("https://example.com/page/page/page/x");

    let issues = crawlie_core::audit::audit(&[ugly, a, b, c, trap], &HashMap::new(), &[], &seed);
    let r = rules(&issues);
    for expected in [
        "url-uppercase",
        "url-underscores",
        "url-double-slash",
        "url-space",
        "url-parameters",
        "url-tracking-params",
        "url-case-duplicate",
        "url-slash-duplicate",
        "url-repetitive-path",
    ] {
        assert!(r.contains(&expected), "expected {expected} in {r:?}");
    }
}

#[test]
fn audit_flags_canonical_health_and_hreflang() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut p = ok_page("https://example.com/a");
    p.canonical = Some("https://example.com/gone".into());
    p.canonicalized = true;
    p.hreflang = vec![
        crawlie_core::types::Hreflang {
            lang: "en-UK!".into(), // invalid region tag
            href: "https://example.com/en".into(),
        },
        crawlie_core::types::Hreflang {
            lang: "de".into(),
            href: "https://example.com/de-gone".into(),
        },
    ];
    let mut redirecting = ok_page("https://example.com/b");
    redirecting.canonical = Some("https://example.com/moved".into());
    redirecting.title = Some("A second, also perfectly reasonable title".into());
    redirecting.h1 = vec!["Second Heading".into()];
    redirecting.meta_description =
        Some("Another meta description comfortably within the recommended length range.".into());

    let mut status_map = HashMap::new();
    status_map.insert("https://example.com/gone".to_string(), 404u16);
    status_map.insert("https://example.com/moved".to_string(), 301u16);
    status_map.insert("https://example.com/de-gone".to_string(), 404u16);

    let issues = crawlie_core::audit::audit(&[p, redirecting], &status_map, &[], &seed);
    let r = rules(&issues);
    for expected in [
        "canonical-to-broken",
        "canonical-to-redirect",
        "hreflang-invalid-code",
        "hreflang-broken",
        "hreflang-no-x-default",
    ] {
        assert!(r.contains(&expected), "expected {expected} in {r:?}");
    }
}

#[test]
fn audit_flags_response_vs_render_diffs() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut p = ok_page("https://example.com/spa");
    p.rendered = true;
    p.render_diff = Some(RenderDiff {
        noindex_raw_only: true,
        canonical_mismatch: true,
        title_rendered_only: true,
        h1_modified: true,
        js_only_links: 4,
        ..Default::default()
    });

    let issues = crawlie_core::audit::audit(&[p], &HashMap::new(), &[], &seed);
    let r = rules(&issues);
    for expected in [
        "render-noindex-raw-only",
        "render-canonical-mismatch",
        "render-title-js",
        "render-h1-modified",
        "render-js-only-links",
    ] {
        assert!(r.contains(&expected), "expected {expected} in {r:?}");
    }
    assert!(
        !r.contains(&"render-title-modified"),
        "rendered-only wins over modified: {r:?}"
    );
}

#[test]
fn audit_flags_markup_and_header_issues() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut p = ok_page("https://example.com/a");
    p.markup = MarkupSignals {
        title_count: 2,
        meta_description_count: 2,
        canonical_count: 2,
        canonical_conflict: true,
        viewport_count: 2,
        meta_refresh: Some("5; url=/new".into()),
        has_favicon: false,
        has_charset: false,
        nofollow_links: 3,
        generic_anchors: 2,
        form_to_http: true,
        imgs_no_dimensions: 1,
        protocol_relative: 1,
        soft404_phrase: true,
        lorem_ipsum: true,
        ..Default::default()
    };
    p.sec_headers = SecurityHeaders::default();

    let issues = crawlie_core::audit::audit(&[p], &HashMap::new(), &[], &seed);
    let r = rules(&issues);
    for expected in [
        "title-multiple",
        "description-multiple",
        "canonical-conflict",
        "viewport-multiple",
        "meta-refresh",
        "favicon-missing",
        "charset-missing",
        "nofollow-internal-links",
        "generic-anchor-text",
        "form-to-http",
        "image-no-dimensions",
        "protocol-relative-links",
        "soft-404",
        "lorem-ipsum",
        "no-csp",
        "no-content-type-options",
        "no-frame-options",
        "no-referrer-policy",
    ] {
        assert!(r.contains(&expected), "expected {expected} in {r:?}");
    }
}

#[test]
fn audit_flags_near_duplicate_pages() {
    let seed = Url::parse("https://example.com/").unwrap();
    let base: Vec<String> = (0..300).map(|i| format!("word{i}")).collect();
    let text_a = base.join(" ");
    let mut tweaked = base.clone();
    for i in (0..300).step_by(60) {
        tweaked[i] = format!("changed{i}");
    }
    let text_b = tweaked.join(" ");

    let mut a = ok_page("https://example.com/a");
    a.simhash = crawlie_core::dedup::simhash(&text_a).map(|h| format!("{h:016x}"));
    let mut b = ok_page("https://example.com/b");
    b.title = Some("A second, also perfectly reasonable title".into());
    b.h1 = vec!["Second Heading".into()];
    b.meta_description =
        Some("Another meta description comfortably within the recommended length range.".into());
    b.simhash = crawlie_core::dedup::simhash(&text_b).map(|h| format!("{h:016x}"));

    let issues = crawlie_core::audit::audit(&[a, b], &HashMap::new(), &[], &seed);
    let near: Vec<_> = issues
        .iter()
        .filter(|i| i.rule == "near-duplicate")
        .collect();
    assert_eq!(
        near.len(),
        1,
        "exactly the later page is flagged: {issues:?}"
    );
    assert_eq!(near[0].url, "https://example.com/b");
    assert!(near[0]
        .detail
        .as_deref()
        .unwrap_or("")
        .contains("similar to https://example.com/a"));
}

#[test]
fn audit_flags_missing_hreflang_return_links() {
    let seed = Url::parse("https://example.com/").unwrap();
    // /en lists /de as an alternate; /de was crawled but lists nothing back.
    let mut en = ok_page("https://example.com/en");
    en.hreflang = vec![
        Hreflang {
            lang: "en".into(),
            href: "https://example.com/en".into(),
        },
        Hreflang {
            lang: "de".into(),
            href: "https://example.com/de".into(),
        },
        Hreflang {
            lang: "x-default".into(),
            href: "https://example.com/en".into(),
        },
    ];
    let mut de = ok_page("https://example.com/de");
    de.title = Some("A second, also perfectly reasonable title".into());
    de.h1 = vec!["Second Heading".into()];
    de.meta_description =
        Some("Another meta description comfortably within the recommended length range.".into());

    let issues = crawlie_core::audit::audit(&[en, de], &HashMap::new(), &[], &seed);
    let missing: Vec<_> = issues
        .iter()
        .filter(|i| i.rule == "hreflang-no-return")
        .collect();
    assert_eq!(
        missing.len(),
        1,
        "exactly one missing return link: {issues:?}"
    );
    assert_eq!(missing[0].url, "https://example.com/en");
}

#[test]
fn audit_flags_broken_pagination() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut p = ok_page("https://example.com/list?page=2");
    p.markup.rel_next = Some("https://example.com/list?page=3".into());
    let mut status_map = HashMap::new();
    status_map.insert("https://example.com/list?page=3".to_string(), 404u16);

    let issues = crawlie_core::audit::audit(&[p], &status_map, &[], &seed);
    let r = rules(&issues);
    assert!(
        r.contains(&"pagination-broken"),
        "expected pagination-broken in {r:?}"
    );
}

#[test]
fn audit_cross_checks_sitemap_membership() {
    use std::collections::HashSet;
    let seed = Url::parse("https://example.com/").unwrap();

    let mut gone = ok_page("https://example.com/gone");
    gone.status = 404;
    let mut noindexed = ok_page("https://example.com/hidden");
    noindexed.meta_robots = Some("noindex".into());
    let unlisted = ok_page("https://example.com/unlisted");

    let sitemap: HashSet<String> = [
        "https://example.com/gone".to_string(),
        "https://example.com/hidden".to_string(),
    ]
    .into();

    let issues = crawlie_core::audit::audit_with_sitemap(
        &[gone, noindexed, unlisted],
        &HashMap::new(),
        &[],
        &seed,
        Some(sitemap),
    );
    let r = rules(&issues);
    assert!(r.contains(&"sitemap-broken"), "404 in sitemap: {r:?}");
    assert!(r.contains(&"sitemap-noindex"), "noindex in sitemap: {r:?}");
    assert!(
        r.contains(&"not-in-sitemap"),
        "indexable page missing from sitemap: {r:?}"
    );
}

#[test]
fn audit_flags_redirect_loops_and_insecure_links() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut looper = ok_page("https://example.com/loop");
    looper.status = 0;
    looper.error = Some("too many redirects".into());

    let mut insecure = ok_page("https://example.com/secure");
    insecure.external_links = vec!["http://other.example/x".into()];

    let issues = crawlie_core::audit::audit(&[looper, insecure], &HashMap::new(), &[], &seed);
    let r = rules(&issues);
    assert!(
        r.contains(&"redirect-loop"),
        "expected redirect-loop in {r:?}"
    );
    assert!(
        !r.contains(&"connection-error"),
        "redirect loop must not double-report as connection error: {r:?}"
    );
    assert!(
        r.contains(&"https-to-http-link"),
        "expected https-to-http-link in {r:?}"
    );
}

#[test]
fn link_scores_rank_the_hub_highest() {
    // home ← linked by a and b; a,b link only to home. Home should top the ranking.
    let mut home = ok_page("https://example.com/");
    let mut a = ok_page("https://example.com/a");
    let mut b = ok_page("https://example.com/b");
    home.internal_links = vec![];
    a.internal_links = vec!["https://example.com/".into()];
    b.internal_links = vec!["https://example.com/".into()];
    let scores = crawlie_core::scoring::link_scores(&[home, a, b]);
    assert_eq!(scores.len(), 3);
    assert_eq!(scores[0], 100.0, "hub should be the max-scored page");
    assert!(scores[1] < scores[0] && scores[2] < scores[0]);
}

#[test]
fn page_seo_score_drops_with_issues() {
    let seed = Url::parse("https://example.com/").unwrap();
    let clean = ok_page("https://example.com/clean");
    let mut bad = ok_page("https://example.com/bad");
    bad.title = None; // error
    bad.meta_description = None; // warning
    bad.canonical = None; // notice
    bad.h1 = vec!["A Different Heading".into()]; // identical H1s would trip h1-duplicate
    let pages = vec![clean, bad];
    let issues = crawlie_core::audit::audit(&pages, &HashMap::new(), &[], &seed);
    let scores = crawlie_core::scoring::page_seo_scores(&pages, &issues);
    assert_eq!(scores[0], 100, "clean page should be 100");
    assert!(
        scores[1] < 100 && scores[1] > 0,
        "bad page should drop below 100, got {}",
        scores[1]
    );
    assert!(scores[1] < scores[0]);
}

#[test]
fn accessibility_has_its_own_score_and_doesnt_touch_health_or_seo() {
    use crawlie_core::types::A11ySignals;
    let seed = Url::parse("https://example.com/").unwrap();
    let mut clean = ok_page("https://example.com/clean");
    clean.a11y.score = crawlie_core::scoring::a11y_score(&clean); // no failures → 100
    let mut bad = ok_page("https://example.com/bad");
    // Distinct metadata so the only findings on this page are accessibility ones
    // (identical titles/descriptions/H1s would otherwise trip the duplicate rules).
    bad.title = Some("A different, perfectly reasonable page title here".into());
    bad.meta_description = Some(
        "A distinct meta description, comfortably within the recommended snippet length.".into(),
    );
    bad.h1 = vec!["A Different Heading".into()];
    // Several WCAG failures, but no SEO problems.
    bad.a11y = A11ySignals {
        links_no_text: 5,
        links_total: 10,
        inputs_no_label: 2,
        controls_total: 2,
        viewport_blocks_zoom: true,
        skipped_heading: true,
        ..Default::default()
    };
    bad.a11y.score = crawlie_core::scoring::a11y_score(&bad);
    let pages = vec![clean, bad];
    let issues = crawlie_core::audit::audit(&pages, &HashMap::new(), &[], &seed);

    // The a11y failures surface as Accessibility issues...
    let a11y_issues = issues
        .iter()
        .filter(|i| i.category == crawlie_core::types::Category::Accessibility)
        .count();
    assert!(
        a11y_issues >= 4,
        "expected several a11y issues, got {a11y_issues}"
    );

    // ...but they leave the per-page SEO score and the site health score alone.
    let seo = crawlie_core::scoring::page_seo_scores(&pages, &issues);
    assert_eq!(seo[1], 100, "a11y issues must not lower the SEO score");
    assert_eq!(
        crawlie_core::scoring::health_score(&pages, &issues),
        100,
        "a11y issues must not lower health"
    );

    // The dedicated a11y score does drop, and the site score reflects it.
    assert!(pages[1].a11y.score < 60, "bad page a11y score should drop");
    let site = crawlie_core::scoring::site_a11y_score(&pages);
    assert!(
        site > pages[1].a11y.score && site < 100,
        "site avg sits between, got {site}"
    );
}

#[test]
fn recompute_heals_stale_scores_from_signals() {
    // A report saved with the old stuck-8 GEO score but intact signals should
    // self-heal when reloaded (recompute).
    let mut page = ok_page("https://example.com/rich"); // good geo signals
    page.geo.score = 8;
    page.seo_score = 0;
    page.link_score = 0.0;
    let mut result = CrawlResult {
        config: CrawlConfig::new("https://example.com"),
        pages: vec![page],
        issues: vec![],
        summary: Summary {
            total_pages: 1,
            errors: 0,
            warnings: 0,
            notices: 0,
            good: 0,
            health_score: 0,
            geo_score: 8,
            a11y_score: 100,
            avg_response_ms: 0,
            indexable_pages: 1,
            duplicate_pages: 0,
            by_status: Default::default(),
            by_category: Default::default(),
            by_depth: Default::default(),
            duration_ms: 0,
        },
        robots_found: false,
        sitemap_urls: 0,
        sitemap_found: false,
        robots_blocked: vec![],
        llms_txt_found: false,
        link_graph: Default::default(),
        seed_redirected_from: None,
        started_at: 0,
    };
    crawlie_core::scoring::recompute(&mut result);
    assert!(
        result.pages[0].geo.score > 8,
        "page geo should heal, got {}",
        result.pages[0].geo.score
    );
    assert!(
        result.summary.geo_score > 8,
        "site geo should heal, got {}",
        result.summary.geo_score
    );
}

#[test]
fn geo_score_reads_real_signals_not_defaults() {
    // Regression: geo_score must reflect the page's actual GeoSignals.
    let p = ok_page("https://example.com/rich"); // has structured data, author, answerable…
    let score = crawlie_core::scoring::geo_score(&p);
    assert!(
        score > 8,
        "rich page should score well above the old stuck-8 bug, got {score}"
    );
}

#[test]
fn top_fixes_rank_errors_first() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut bad = ok_page("https://example.com/x");
    bad.title = None; // error: title-missing
    bad.canonical = None; // notice: canonical-missing
    bad.word_count = 5; // notice: thin-content
    let issues = crawlie_core::audit::audit(&[bad], &HashMap::new(), &[], &seed);
    let fixes = crawlie_core::top_fixes(&issues, 5);
    assert!(!fixes.is_empty());
    assert_eq!(
        fixes[0].severity,
        Severity::Error,
        "errors should rank first, got {:?}",
        fixes[0].rule
    );
    assert!(!fixes[0].how_to_fix.is_empty(), "fix should carry guidance");
}

#[test]
fn old_reports_without_new_score_fields_still_deserialize() {
    // A page JSON saved before link_score/seo_score existed must still load.
    let json = r#"{
        "url":"https://example.com/","finalUrl":"https://example.com/","status":200,
        "redirectChain":[],"contentType":"text/html","responseTimeMs":100,"sizeBytes":1000,
        "depth":0,"server":null,"contentEncoding":"gzip","cacheControl":null,"xRobotsTag":null,
        "hsts":true,"title":"Home","metaDescription":null,"h1":["Home"],"h2Count":0,"h3Count":0,
        "wordCount":300,"textRatio":0.4,"canonical":null,"metaRobots":null,"lang":"en",
        "hasViewport":true,"indexable":true,"indexability":null,"canonicalized":false,
        "imagesTotal":0,"imagesMissingAlt":0,"internalLinks":[],"externalLinks":[],"inlinks":1,
        "ogTitle":null,"ogImage":null,"twitterCard":null,"schemaTypes":[],"hreflang":[],
        "mixedContent":0,"geo":{"semanticHtml":false,"structuredData":false,"hasAuthor":false,
        "hasDate":false,"faqSchema":false,"questionHeadings":0,"structuredBlocks":0,
        "answerable":false,"score":0},"contentHash":null,"duplicateOf":null,"error":null
    }"#;
    let page: Page = serde_json::from_str(json).expect("old page JSON should deserialize");
    assert_eq!(page.link_score, 0.0);
    assert_eq!(page.seo_score, 0);
}

#[test]
fn audit_flags_content_that_only_renders_with_js() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut page = ok_page("https://example.com/spa");
    // The raw HTML is near-empty; the 500-word body only exists after JS renders.
    page.rendered = true;
    page.pre_render_word_count = 5;
    let issues = crawlie_core::audit::audit(&[page], &HashMap::new(), &[], &seed);
    assert!(
        rules(&issues).contains(&"content-requires-js"),
        "expected content-requires-js, got {:?}",
        rules(&issues)
    );
}

#[test]
fn audit_does_not_flag_js_content_when_raw_html_is_substantial() {
    let seed = Url::parse("https://example.com/").unwrap();
    let mut page = ok_page("https://example.com/ssr");
    // Server-rendered: nearly all the content is already in the raw HTML, so the
    // page does not depend on JavaScript even though render mode was on.
    page.rendered = true;
    page.pre_render_word_count = 480;
    let issues = crawlie_core::audit::audit(&[page], &HashMap::new(), &[], &seed);
    assert!(
        !rules(&issues).contains(&"content-requires-js"),
        "should not flag server-rendered content as JS-dependent"
    );
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
