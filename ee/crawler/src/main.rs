// Crawlie Cloud hosted-crawl service.
//
// Copyright (c) 2026 Spronta Ltd. Licensed under the Crawlie Enterprise Edition
// License (see ee/LICENSE) — NOT the repo's MIT license.
//
// A thin HTTP wrapper around the MIT crawlie-core engine, run inside a
// Cloudflare Container. One endpoint: POST /crawl takes a CrawlConfig and
// streams newline-delimited JSON — each crawl progress event as it happens,
// then a final `{ "type": "result", ... }` (or `{ "type": "error", ... }`).
// The crawlie.app Worker forwards these to the browser as SSE.

use axum::{
    body::Body,
    http::StatusCode,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use crawlie_core::{crawl, types::CrawlConfig, types::CrawlEvent, types::CrawlResult, CancelToken};
use crawlie_rules::{load, RulePack};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

/// One `.crawlie` rule pack source (marketing / brand / slop monitoring).
#[derive(Deserialize)]
struct PackSrc {
    name: String,
    source: String,
}

/// Crawl request = a CrawlConfig plus optional rule packs to evaluate.
#[derive(Deserialize)]
struct CrawlRequest {
    #[serde(flatten)]
    config: CrawlConfig,
    #[serde(default)]
    packs: Vec<PackSrc>,
}

/// Evaluate each pack against every crawled page's text; returns a JSON summary
/// (per-URL ledgers + aggregate) grafted onto the report as `packs`.
fn evaluate_packs(packs: &[PackSrc], result: &CrawlResult) -> Value {
    let parsed: Vec<RulePack> = packs
        .iter()
        .filter_map(|p| load(&p.name, &p.source).ok())
        .collect();
    if parsed.is_empty() {
        return Value::Null;
    }
    let mut by_url = serde_json::Map::new();
    let mut total = 0.0f64;
    let mut pages_flagged = 0usize;
    for page in &result.pages {
        let text = page.text.as_deref().unwrap_or("");
        if text.is_empty() {
            continue;
        }
        let ledgers: Vec<_> = parsed
            .iter()
            .map(|pack| pack.evaluate(text))
            .filter(|l| !l.hits.is_empty())
            .collect();
        if !ledgers.is_empty() {
            let page_score: f64 = ledgers.iter().map(|l| l.score).sum();
            total += page_score;
            pages_flagged += 1;
            by_url.insert(
                page.url.clone(),
                json!({ "score": page_score, "ledgers": ledgers }),
            );
        }
    }
    json!({
        "totalScore": total,
        "pagesFlagged": pages_flagged,
        "packNames": parsed.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
        "byUrl": by_url,
    })
}

async fn crawl_handler(Json(req): Json<CrawlRequest>) -> Response {
    let (tx, rx) = mpsc::unbounded_channel::<String>();

    tokio::spawn(async move {
        // Progress events → one JSON line each.
        let tx_events = tx.clone();
        let on_event = move |ev: CrawlEvent| {
            if let Ok(s) = serde_json::to_string(&ev) {
                let _ = tx_events.send(s);
            }
        };

        let final_line = match crawl(req.config, on_event, CancelToken::new()).await {
            Ok(result) => {
                let packs = evaluate_packs(&req.packs, &result);
                let mut rv = serde_json::to_value(&result).unwrap_or_else(|_| json!({}));
                if let Value::Object(ref mut m) = rv {
                    m.insert("packs".into(), packs);
                }
                json!({ "type": "result", "result": rv })
            }
            Err(e) => json!({ "type": "error", "message": e.to_string() }),
        };
        if let Ok(s) = serde_json::to_string(&final_line) {
            let _ = tx.send(s);
        }
    });

    let stream = UnboundedReceiverStream::new(rx).map(|line| {
        Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(format!("{line}\n")))
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/x-ndjson")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(stream))
        .expect("valid response")
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/crawl", post(crawl_handler))
        .route("/health", get(|| async { "ok" }));

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("bind");
    eprintln!("crawlie-crawler-service listening on :{port}");
    axum::serve(listener, app).await.expect("serve");
}
