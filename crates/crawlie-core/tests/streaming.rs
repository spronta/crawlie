//! End-to-end test that the streaming (out-of-core) crawl produces byte-for-byte
//! the same audit as the default in-memory crawl. A tiny linked site is served
//! locally; both `crawl` and `crawl_to_store` run against it and their issues +
//! summary are compared.

use crawlie_core::{crawl, crawl_to_store, CancelToken, CrawlConfig, CrawlMode, Issue};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The fixture site: a handful of distinct, cross-linked pages plus one dead
/// internal link (`/missing`) so the broken-link rule fires.
fn page_for(path: &str) -> (u16, &'static str) {
    match path {
        "/" => (
            200,
            "<!doctype html><html lang=\"en\"><head>\
             <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
             <title>Home Page Of The Streaming Crawl Test Fixture Site</title>\
             <meta name=\"description\" content=\"The home page of the fixture, with a description long enough to satisfy the meta description length check used by the audit.\">\
             </head><body><main><h1>Home</h1>\
             <p>This home page has plenty of words so it is not flagged as thin content by the crawler audit, and it links onward to the other fixture pages below for discovery.</p>\
             <a href=\"/a\">A</a><a href=\"/b\">B</a><a href=\"/a\">A again</a>\
             <a href=\"/missing\">dead</a><a href=\"https://example.org/x\">ext</a>\
             </main></body></html>",
        ),
        "/a" => (
            200,
            "<!doctype html><html lang=\"en\"><head>\
             <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
             <title>Page A — A Distinct Title For The First Inner Page</title>\
             <meta name=\"description\" content=\"Page A has its own distinct description that is comfortably within the recommended length window for meta descriptions.\">\
             </head><body><main><h1>Page A</h1>\
             <p>Page A carries a unique block of body content with more than enough words to clear the thin-content threshold and to make its text ratio reasonable for the audit.</p>\
             <a href=\"/\">Home</a><a href=\"/b\">B</a></main></body></html>",
        ),
        // Page B deliberately omits the meta description and the H1 to fire rules.
        "/b" => (
            200,
            "<!doctype html><html lang=\"en\"><head>\
             <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
             <title>Page B — Another Distinct Title For The Second Page</title>\
             </head><body><main>\
             <p>Page B has body text with a good number of words so it is not thin, but it intentionally lacks a meta description and an H1 heading to exercise those audit rules.</p>\
             <a href=\"/\">Home</a><a href=\"/a\">A</a></main></body></html>",
        ),
        _ => (404, "not found"),
    }
}

async fn spawn_site() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                let (status, body) = page_for(&path);
                let reason = if status == 200 { "OK" } else { "Not Found" };
                let resp = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.flush().await;
            });
        }
    });
    port
}

fn cfg(port: u16) -> CrawlConfig {
    CrawlConfig {
        mode: CrawlMode::Site,
        max_pages: 50,
        // Keep the test offline and deterministic: no external HEAD checks.
        check_external: false,
        respect_robots: false,
        use_sitemap: false,
        ..CrawlConfig::new(format!("http://127.0.0.1:{port}/"))
    }
}

/// Sort key making the issue list order-independent for comparison.
fn sorted(mut issues: Vec<Issue>) -> Vec<(String, String, Option<String>)> {
    let mut v: Vec<_> = issues
        .drain(..)
        .map(|i| (i.url, i.rule, i.detail))
        .collect();
    v.sort();
    v
}

#[tokio::test]
async fn streaming_crawl_matches_in_memory() {
    let port = spawn_site().await;

    let mem = crawl(cfg(port), |_| {}, CancelToken::new())
        .await
        .expect("in-memory crawl");

    let db = std::env::temp_dir().join(format!("crawlie-stream-{port}.db"));
    let _ = std::fs::remove_file(&db);
    let (stream, store) = crawl_to_store(cfg(port), &db, |_| {}, CancelToken::new())
        .await
        .expect("streaming crawl");

    // Same pages crawled, stored on disk not in the returned result.
    assert!(stream.pages.is_empty(), "streaming result holds no pages");
    assert_eq!(store.count().unwrap(), mem.pages.len());
    assert!(
        mem.pages.len() >= 3,
        "fixture should yield home + a + b + 404"
    );

    // Identical audit findings (order-independent).
    assert_eq!(
        sorted(stream.issues.clone()),
        sorted(mem.issues.clone()),
        "streaming and in-memory issues must match"
    );

    // Identical summary (timing fields aside).
    let (a, b) = (&mem.summary, &stream.summary);
    assert_eq!(a.total_pages, b.total_pages);
    assert_eq!(a.errors, b.errors);
    assert_eq!(a.warnings, b.warnings);
    assert_eq!(a.notices, b.notices);
    assert_eq!(a.good, b.good);
    assert_eq!(a.health_score, b.health_score);
    assert_eq!(a.geo_score, b.geo_score);
    assert_eq!(a.indexable_pages, b.indexable_pages);
    assert_eq!(a.duplicate_pages, b.duplicate_pages);
    assert_eq!(a.by_status, b.by_status);
    assert_eq!(a.by_category, b.by_category);
    assert_eq!(a.by_depth, b.by_depth);

    // Derived fields were written back into the on-disk pages: the home page
    // accumulates inlinks (A and B link to it) and a non-zero SEO score.
    let mut home_inlinks = 0;
    let mut any_seo = false;
    store
        .for_each_page(|_, p| {
            if p.url.ends_with('/') && p.status == 200 {
                home_inlinks = p.inlinks;
            }
            if p.seo_score > 0 {
                any_seo = true;
            }
        })
        .unwrap();
    assert!(home_inlinks >= 2, "home should have inlinks from A and B");
    assert!(any_seo, "SEO scores should be written back to the store");

    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn streaming_finds_the_broken_link() {
    let port = spawn_site().await;
    let db = std::env::temp_dir().join(format!("crawlie-broken-{port}.db"));
    let _ = std::fs::remove_file(&db);
    let (stream, _store) = crawl_to_store(cfg(port), &db, |_| {}, CancelToken::new())
        .await
        .expect("streaming crawl");
    assert!(
        stream.issues.iter().any(|i| i.rule == "broken-link"),
        "the /missing link should be flagged broken"
    );
    let _ = std::fs::remove_file(&db);
}
