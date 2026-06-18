//! Low-level HTTP fetching. Redirects are followed manually so the full chain
//! is captured, and only HTML bodies are downloaded as text.

use crate::types::Redirect;
use reqwest::{header, Client};
use std::time::{Duration, Instant};
use url::Url;

/// Result of fetching one URL to its terminal response.
pub struct FetchOutcome {
    pub final_url: Url,
    pub status: u16,
    pub redirects: Vec<Redirect>,
    pub content_type: Option<String>,
    pub is_html: bool,
    pub body: Option<String>,
    pub size_bytes: usize,
    pub elapsed_ms: u64,
    pub server: Option<String>,
    pub content_encoding: Option<String>,
    pub cache_control: Option<String>,
    pub x_robots_tag: Option<String>,
    pub hsts: bool,
}

/// Build a connection-pooling client. Redirects are disabled at the client
/// level because we resolve them by hand to record the chain.
pub fn build_client(user_agent: &str, timeout_secs: u64) -> reqwest::Result<Client> {
    Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(32)
        .gzip(true)
        .brotli(true)
        .build()
}

fn content_type(resp: &reqwest::Response) -> Option<String> {
    header_str(resp, header::CONTENT_TYPE.as_str())
}

fn header_str(resp: &reqwest::Response, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Headers crawlie reports on (compression, caching, indexability, transport).
struct Headers {
    server: Option<String>,
    content_encoding: Option<String>,
    cache_control: Option<String>,
    x_robots_tag: Option<String>,
    hsts: bool,
}

fn extract_headers(resp: &reqwest::Response) -> Headers {
    Headers {
        server: header_str(resp, "server"),
        content_encoding: header_str(resp, "content-encoding"),
        cache_control: header_str(resp, "cache-control"),
        x_robots_tag: header_str(resp, "x-robots-tag"),
        hsts: resp.headers().contains_key("strict-transport-security"),
    }
}

/// Fetch `start_url`, following up to `max_redirects` hops, returning the
/// terminal response. The body is only read (as text) for HTML content types.
pub async fn fetch(
    client: &Client,
    start_url: &Url,
    max_redirects: usize,
) -> Result<FetchOutcome, reqwest::Error> {
    let start = Instant::now();
    let mut current = start_url.clone();
    let mut redirects = Vec::new();

    loop {
        let resp = client.get(current.clone()).send().await?;
        let status = resp.status();

        if status.is_redirection() && redirects.len() < max_redirects {
            if let Some(next) = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|loc| current.join(loc).ok())
            {
                redirects.push(Redirect {
                    from: current.to_string(),
                    to: next.to_string(),
                    status: status.as_u16(),
                });
                if next == current {
                    // Self-referential redirect loop — stop here.
                    let h = extract_headers(&resp);
                    return Ok(FetchOutcome {
                        final_url: current,
                        status: status.as_u16(),
                        redirects,
                        content_type: content_type(&resp),
                        is_html: false,
                        body: None,
                        size_bytes: 0,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        server: h.server,
                        content_encoding: h.content_encoding,
                        cache_control: h.cache_control,
                        x_robots_tag: h.x_robots_tag,
                        hsts: h.hsts,
                    });
                }
                current = next;
                continue;
            }
        }

        // Terminal response (or redirect we can't/won't follow further).
        let ct = content_type(&resp);
        let is_html = ct
            .as_deref()
            .map(|c| c.contains("text/html") || c.contains("application/xhtml"))
            .unwrap_or(false);
        let status_u16 = status.as_u16();
        let h = extract_headers(&resp);
        let bytes = resp.bytes().await?;
        let size_bytes = bytes.len();
        let body = if is_html {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        } else {
            None
        };

        return Ok(FetchOutcome {
            final_url: current,
            status: status_u16,
            redirects,
            content_type: ct,
            is_html,
            body,
            size_bytes,
            elapsed_ms: start.elapsed().as_millis() as u64,
            server: h.server,
            content_encoding: h.content_encoding,
            cache_control: h.cache_control,
            x_robots_tag: h.x_robots_tag,
            hsts: h.hsts,
        });
    }
}

/// Cheap liveness check for link verification: HEAD, falling back to GET when a
/// server rejects HEAD. Returns `0` for connection-level failures.
pub async fn check_status(client: &Client, url: &Url) -> u16 {
    match client.head(url.clone()).send().await {
        Ok(r) => {
            let s = r.status().as_u16();
            if s == 405 || s == 501 {
                match client.get(url.clone()).send().await {
                    Ok(r2) => r2.status().as_u16(),
                    Err(_) => 0,
                }
            } else {
                s
            }
        }
        Err(_) => 0,
    }
}
