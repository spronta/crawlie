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
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

/// Terminal line of the stream — the full report or an error.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Final {
    Result { result: Box<CrawlResult> },
    Error { message: String },
}

async fn crawl_handler(Json(config): Json<CrawlConfig>) -> Response {
    let (tx, rx) = mpsc::unbounded_channel::<String>();

    tokio::spawn(async move {
        // Progress events → one JSON line each.
        let tx_events = tx.clone();
        let on_event = move |ev: CrawlEvent| {
            if let Ok(s) = serde_json::to_string(&ev) {
                let _ = tx_events.send(s);
            }
        };

        let final_line = match crawl(config, on_event, CancelToken::new()).await {
            Ok(result) => Final::Result {
                result: Box::new(result),
            },
            Err(e) => Final::Error {
                message: e.to_string(),
            },
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
