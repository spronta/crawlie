//! Low-level HTTP fetching. Redirects are followed manually so the full chain
//! is captured, and only HTML bodies are downloaded as text.

use crate::types::{Redirect, SecurityHeaders};
use flate2::read::{DeflateDecoder, MultiGzDecoder, ZlibDecoder};
use reqwest::{header, Client};
use std::io::Read;
use std::time::{Duration, Instant};
use url::Url;

/// Default per-response body cap. Bounds peak memory to roughly
/// `concurrency × cap` however hostile the site, which is what lets hosted
/// crawls run at high concurrency on a fixed-size container. Real HTML pages
/// are well under this; anything larger is truncated (the parse still works on
/// the prefix) rather than buffered without limit.
pub const DEFAULT_MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

/// Decompressed output is allowed to expand a few times past the raw cap
/// before we stop — enough for legitimately compressible HTML, small enough
/// that a decompression bomb can't take the process down.
const DECODE_EXPANSION: usize = 4;

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
    pub sec_headers: SecurityHeaders,
}

/// Build a connection-pooling client. Redirects are disabled at the client
/// level because we resolve them by hand to record the chain.
///
/// We advertise `Accept-Encoding` ourselves and disable reqwest's transparent
/// decompression. reqwest strips the `Content-Encoding` header once it decodes
/// a body, which would make every compressed response look uncompressed to the
/// `no-compression` audit rule. Instead we keep the raw header and decompress
/// bodies by hand in [`decode_body`].
pub fn build_client(user_agent: &str, timeout_secs: u64) -> reqwest::Result<Client> {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::ACCEPT_ENCODING,
        header::HeaderValue::from_static("gzip, br, deflate"),
    );
    Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(32)
        .default_headers(headers)
        .no_gzip()
        .no_brotli()
        .build()
}

/// Decode a response body according to its `Content-Encoding`, reading at most
/// `max_out` decompressed bytes (decompression-bomb guard). Returns the bytes
/// unchanged when the encoding is absent, unrecognised, or decompression
/// fails — a malformed stream should never lose the page.
fn decode_body(bytes: &[u8], encoding: Option<&str>, max_out: usize) -> Vec<u8> {
    let enc = match encoding {
        Some(e) => e.trim().to_ascii_lowercase(),
        None => return bytes.to_vec(),
    };
    let cap = max_out as u64;
    let mut out = Vec::new();
    let ok = if enc.contains("br") {
        brotli::Decompressor::new(bytes, 4096)
            .take(cap)
            .read_to_end(&mut out)
            .is_ok()
    } else if enc.contains("gzip") {
        MultiGzDecoder::new(bytes)
            .take(cap)
            .read_to_end(&mut out)
            .is_ok()
    } else if enc.contains("deflate") {
        // Most servers send zlib-wrapped deflate; fall back to raw deflate.
        if ZlibDecoder::new(bytes).take(cap).read_to_end(&mut out).is_ok() {
            true
        } else {
            out.clear();
            DeflateDecoder::new(bytes)
                .take(cap)
                .read_to_end(&mut out)
                .is_ok()
        }
    } else {
        // identity or an encoding we don't handle — leave it alone.
        return bytes.to_vec();
    };
    if ok {
        out
    } else {
        bytes.to_vec()
    }
}

/// Read a response body incrementally, stopping at `cap` bytes. Bodies at or
/// under the cap arrive intact; anything larger is truncated and the
/// connection dropped, so one huge (or hostile) resource can't balloon memory.
async fn read_body_capped(
    mut resp: reqwest::Response,
    cap: usize,
) -> Result<Vec<u8>, reqwest::Error> {
    let mut buf: Vec<u8> = Vec::with_capacity(
        resp.content_length()
            .map(|l| (l as usize).min(cap))
            .unwrap_or(64 * 1024),
    );
    while let Some(chunk) = resp.chunk().await? {
        let room = cap - buf.len();
        if chunk.len() >= room {
            buf.extend_from_slice(&chunk[..room]);
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
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

/// Headers crawlie reports on (compression, caching, indexability, transport,
/// security posture).
struct Headers {
    server: Option<String>,
    content_encoding: Option<String>,
    cache_control: Option<String>,
    x_robots_tag: Option<String>,
    hsts: bool,
    sec_headers: SecurityHeaders,
}

fn extract_headers(resp: &reqwest::Response) -> Headers {
    let csp = header_str(resp, "content-security-policy");
    Headers {
        server: header_str(resp, "server"),
        content_encoding: header_str(resp, "content-encoding"),
        cache_control: header_str(resp, "cache-control"),
        x_robots_tag: header_str(resp, "x-robots-tag"),
        hsts: resp.headers().contains_key("strict-transport-security"),
        sec_headers: SecurityHeaders {
            csp: csp.is_some(),
            x_content_type_options: resp.headers().contains_key("x-content-type-options"),
            // CSP frame-ancestors supersedes X-Frame-Options.
            x_frame_options: resp.headers().contains_key("x-frame-options")
                || csp
                    .as_deref()
                    .map(|c| c.contains("frame-ancestors"))
                    .unwrap_or(false),
            referrer_policy: resp.headers().contains_key("referrer-policy"),
        },
    }
}

/// Fetch `start_url`, following up to `max_redirects` hops, returning the
/// terminal response. The body is only read (as text) for HTML content types.
/// At most [`DEFAULT_MAX_BODY_BYTES`] of body are buffered per response.
pub async fn fetch(
    client: &Client,
    start_url: &Url,
    max_redirects: usize,
) -> Result<FetchOutcome, reqwest::Error> {
    fetch_capped(client, start_url, max_redirects, DEFAULT_MAX_BODY_BYTES).await
}

/// [`fetch`] with an explicit per-response body cap (bytes).
pub async fn fetch_capped(
    client: &Client,
    start_url: &Url,
    max_redirects: usize,
    max_body: usize,
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
                        sec_headers: h.sec_headers,
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
        let raw = read_body_capped(resp, max_body).await?;
        // Decompress by hand (reqwest's transparent decoding is disabled) so the
        // negotiated `Content-Encoding` is preserved for the audit rules while
        // `size_bytes` still reflects the uncompressed payload.
        let decoded = decode_body(
            &raw,
            h.content_encoding.as_deref(),
            max_body.saturating_mul(DECODE_EXPANSION),
        );
        let size_bytes = decoded.len();
        let body = if is_html {
            Some(String::from_utf8_lossy(&decoded).into_owned())
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
            sec_headers: h.sec_headers,
        });
    }
}

/// Liveness check that follows redirects (the client has auto-redirects
/// disabled), returning the *final* HTTP status. Uses HEAD, falling back to GET
/// when a server rejects HEAD; returns `0` for connection-level failures.
///
/// Following redirects matters for special-file detection (robots.txt,
/// sitemap.xml, llms.txt): many sites 301 the apex to `www` (or http→https), so
/// `https://example.com/llms.txt` → 301 → `https://www.example.com/llms.txt`
/// (200). The file still exists, so the chain must resolve to its terminal 200.
pub async fn check_status(client: &Client, url: &Url) -> u16 {
    let mut current = url.clone();
    for _ in 0..6 {
        let resp = match client.head(current.clone()).send().await {
            Ok(r) => r,
            Err(_) => return 0,
        };
        // Some servers reject HEAD — retry the same URL with GET.
        let (status, resp) = if matches!(resp.status().as_u16(), 405 | 501) {
            match client.get(current.clone()).send().await {
                Ok(r) => (r.status().as_u16(), r),
                Err(_) => return 0,
            }
        } else {
            (resp.status().as_u16(), resp)
        };

        if (300..400).contains(&status) {
            if let Some(next) = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|loc| current.join(loc).ok())
            {
                if next != current {
                    current = next;
                    continue;
                }
            }
        }
        return status;
    }
    0
}

/// HEAD a resource (following up to 3 redirects) and return its
/// `Content-Length` when it resolves 200. Used for image weight checks —
/// resources served chunked (no length header) return `None` rather than
/// paying for a GET.
pub async fn check_size(client: &Client, url: &Url) -> Option<u64> {
    let mut current = url.clone();
    for _ in 0..3 {
        let resp = client.head(current.clone()).send().await.ok()?;
        let status = resp.status().as_u16();
        if (300..400).contains(&status) {
            if let Some(next) = resp
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|loc| current.join(loc).ok())
            {
                if next != current {
                    current = next;
                    continue;
                }
            }
            return None;
        }
        if status != 200 {
            return None;
        }
        return resp
            .headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const HTML: &str =
        "<html><head><title>Hi</title></head><body>hello compressed world</body></html>";

    /// Serve a single canned HTTP/1.1 response carrying `body` with the given
    /// `Content-Encoding`, then close. Returns the bound port.
    async fn serve_once(encoding: &'static str, body: Vec<u8>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await; // drain the request line/headers
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                encoding,
                body.len()
            );
            sock.write_all(head.as_bytes()).await.unwrap();
            sock.write_all(&body).await.unwrap();
            sock.flush().await.unwrap();
        });
        port
    }

    async fn fetch_from(port: u16) -> FetchOutcome {
        let client = build_client("crawlie-test", 10).unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
        fetch(&client, &url, 5).await.unwrap()
    }

    #[tokio::test]
    async fn detects_gzip_and_decodes_body() {
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(HTML.as_bytes()).unwrap();
        let gz = enc.finish().unwrap();

        let out = fetch_from(serve_once("gzip", gz).await).await;

        // The negotiated encoding must survive so `no-compression` stays quiet.
        assert_eq!(out.content_encoding.as_deref(), Some("gzip"));
        assert!(out.is_html);
        assert!(out.body.unwrap().contains("hello compressed world"));
    }

    #[tokio::test]
    async fn detects_brotli_and_decodes_body() {
        let mut c = brotli::CompressorWriter::new(Vec::new(), 4096, 5, 22);
        c.write_all(HTML.as_bytes()).unwrap();
        let br = c.into_inner();

        let out = fetch_from(serve_once("br", br).await).await;

        assert_eq!(out.content_encoding.as_deref(), Some("br"));
        assert!(out.body.unwrap().contains("hello compressed world"));
    }
}
