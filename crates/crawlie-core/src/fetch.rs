//! Low-level HTTP fetching. Redirects are followed manually so the full chain
//! is captured, and only HTML bodies are downloaded as text.

use crate::types::Redirect;
use flate2::read::{DeflateDecoder, MultiGzDecoder, ZlibDecoder};
use reqwest::{header, Client};
use std::io::Read;
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

/// Decode a response body according to its `Content-Encoding`. Returns the
/// bytes unchanged when the encoding is absent, unrecognised, or decompression
/// fails — a malformed stream should never lose the page.
fn decode_body(bytes: &[u8], encoding: Option<&str>) -> Vec<u8> {
    let enc = match encoding {
        Some(e) => e.trim().to_ascii_lowercase(),
        None => return bytes.to_vec(),
    };
    let mut out = Vec::new();
    let ok = if enc.contains("br") {
        brotli::Decompressor::new(bytes, 4096)
            .read_to_end(&mut out)
            .is_ok()
    } else if enc.contains("gzip") {
        MultiGzDecoder::new(bytes).read_to_end(&mut out).is_ok()
    } else if enc.contains("deflate") {
        // Most servers send zlib-wrapped deflate; fall back to raw deflate.
        if ZlibDecoder::new(bytes).read_to_end(&mut out).is_ok() {
            true
        } else {
            out.clear();
            DeflateDecoder::new(bytes).read_to_end(&mut out).is_ok()
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
        let raw = resp.bytes().await?;
        // Decompress by hand (reqwest's transparent decoding is disabled) so the
        // negotiated `Content-Encoding` is preserved for the audit rules while
        // `size_bytes` still reflects the uncompressed payload.
        let decoded = decode_body(&raw, h.content_encoding.as_deref());
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
