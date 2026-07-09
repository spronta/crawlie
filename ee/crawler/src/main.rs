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
    extract::{Query, State},
    http::StatusCode,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use crawlie_core::types::{Category, Issue, Page, RuleInfo, Severity};
use crawlie_core::{crawl, types::CrawlConfig, types::CrawlEvent, types::CrawlResult, CancelToken};
use crawlie_rules::{load, CheckSeverity, PageFacts, RulePack};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

// ---------------------------------------------------------------------------
// Job registry — the crawl runs as a background task keyed by jobId so its
// lifetime is decoupled from any HTTP request. The Worker starts a job, then
// polls /status; the crawl survives however long a large site takes because no
// single request is held open (which is what got the streaming worker evicted
// mid-crawl). One container instance handles one job (the Worker keys the
// instance by jobId), so the map holds ~one entry.
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct JobProgress {
    crawled: usize,
    discovered: usize,
    queued: usize,
    current: String,
}

struct Job {
    /// running | done | error | saved
    status: &'static str,
    progress: JobProgress,
    /// The finished report (JSON) — kept until the Worker persists it.
    result: Option<Value>,
    error: Option<String>,
    /// Set once the Worker has saved the report to R2/D1 (exactly-once guard).
    report_id: Option<String>,
    cancel: CancelToken,
}

type Jobs = Arc<Mutex<HashMap<String, Job>>>;

/// Turn a finished crawl into the report JSON: apply custom checks (which
/// mutate issues + summary), graft the content-rule ledgers, serialize.
fn finalize_report(mut result: CrawlResult, packs: &[PackSrc]) -> Value {
    let parsed: Vec<RulePack> = packs
        .iter()
        .filter_map(|p| load(&p.name, &p.source).ok())
        .collect();
    apply_checks(&parsed, &mut result);
    let packs_json = evaluate_packs(&parsed, &result);
    let mut rv = serde_json::to_value(&result).unwrap_or_else(|_| json!({}));
    if let Value::Object(ref mut m) = rv {
        m.insert("packs".into(), packs_json);
    }
    rv
}

/// The background crawl task: streams progress into the job, then stores the
/// finished report (or error) — all without holding the job lock across the
/// crawl or the (potentially heavy) finalize step.
async fn run_job(jobs: Jobs, job_id: String, config: CrawlConfig, packs: Vec<PackSrc>) {
    let cancel = jobs
        .lock()
        .ok()
        .and_then(|m| m.get(&job_id).map(|j| j.cancel.clone()))
        .unwrap_or_default();
    let jobs_ev = jobs.clone();
    let jid_ev = job_id.clone();
    let on_event = move |ev: CrawlEvent| {
        if let CrawlEvent::Progress {
            crawled,
            discovered,
            queued,
            current,
        } = ev
        {
            if let Ok(mut m) = jobs_ev.lock() {
                if let Some(j) = m.get_mut(&jid_ev) {
                    j.progress = JobProgress {
                        crawled,
                        discovered,
                        queued,
                        current,
                    };
                }
            }
        }
    };

    let outcome = crawl(config, on_event, cancel).await;
    // Compute the final JSON outside the lock (finalize can be non-trivial).
    let (status, result, error): (&'static str, Option<Value>, Option<String>) = match outcome {
        Ok(result) => ("done", Some(finalize_report(result, &packs)), None),
        Err(e) => ("error", None, Some(e.to_string())),
    };
    if let Ok(mut m) = jobs.lock() {
        if let Some(j) = m.get_mut(&job_id) {
            j.status = status;
            j.result = result;
            j.error = error;
        }
    }
}

/// `POST /start` — begin a crawl job (keyed by `jobId`), returning immediately.
#[derive(Deserialize)]
struct StartRequest {
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(flatten)]
    config: CrawlConfig,
    #[serde(default)]
    packs: Vec<PackSrc>,
}

async fn start_handler(State(jobs): State<Jobs>, Json(req): Json<StartRequest>) -> Json<Value> {
    let job_id = req.job_id.clone();
    {
        let mut m = jobs.lock().unwrap();
        if m.contains_key(&job_id) {
            return Json(json!({ "ok": true, "already": true }));
        }
        m.insert(
            job_id.clone(),
            Job {
                status: "running",
                progress: JobProgress {
                    current: req.config.url.clone(),
                    ..Default::default()
                },
                result: None,
                error: None,
                report_id: None,
                cancel: CancelToken::new(),
            },
        );
    }
    tokio::spawn(run_job(jobs.clone(), job_id, req.config, req.packs));
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct JobQuery {
    job: String,
}

/// `GET /status?job=…` — snapshot a job. The finished report is returned while
/// the job is `done` and not yet finalized; the Worker saves it then calls
/// `/finalize`, after which status is `saved` and only the report id is returned.
async fn status_handler(State(jobs): State<Jobs>, Query(q): Query<JobQuery>) -> Json<Value> {
    let m = jobs.lock().unwrap();
    let out = match m.get(&q.job) {
        None => json!({ "status": "unknown" }),
        Some(j) => match j.status {
            "running" => json!({
                "status": "running",
                "crawled": j.progress.crawled,
                "discovered": j.progress.discovered,
                "queued": j.progress.queued,
                "current": j.progress.current,
            }),
            "done" => json!({ "status": "done", "result": j.result }),
            "saved" => json!({ "status": "saved", "reportId": j.report_id }),
            "error" => json!({ "status": "error", "message": j.error }),
            other => json!({ "status": other }),
        },
    };
    Json(out)
}

/// `POST /finalize {job, reportId}` — mark a job saved. Exactly-once: only the
/// first call sets the report id and returns `first: true` (so the Worker
/// meters + records the crawl once, even if polls race).
#[derive(Deserialize)]
struct FinalizeReq {
    job: String,
    #[serde(rename = "reportId")]
    report_id: String,
}

async fn finalize_handler(State(jobs): State<Jobs>, Json(req): Json<FinalizeReq>) -> Json<Value> {
    let mut m = jobs.lock().unwrap();
    let out = match m.get_mut(&req.job) {
        Some(j) if j.report_id.is_none() => {
            j.report_id = Some(req.report_id.clone());
            j.status = "saved";
            j.result = None; // free the report from memory
            json!({ "first": true })
        }
        Some(j) => json!({ "first": false, "reportId": j.report_id }),
        None => json!({ "first": false }),
    };
    Json(out)
}

async fn cancel_handler(State(jobs): State<Jobs>, Json(req): Json<JobQuery>) -> Json<Value> {
    if let Some(j) = jobs.lock().unwrap().get(&req.job) {
        j.cancel.cancel();
    }
    Json(json!({ "ok": true }))
}

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

/// Map one crawled page to the fact view custom checks evaluate against.
fn page_facts<'a>(
    page: &'a Page,
    all_links: &'a [String],
    extractions: &'a [String],
) -> PageFacts<'a> {
    // Path without scheme/host/query, matching the crawler's URL handling.
    let path = page
        .url
        .splitn(4, '/')
        .nth(3)
        .map(|rest| &page.url[page.url.len() - rest.len() - 1..])
        .unwrap_or("/");
    let path = path.split('?').next().unwrap_or("/");
    PageFacts {
        url: &page.url,
        path,
        title: page.title.as_deref(),
        description: page.meta_description.as_deref(),
        h1: page.h1.first().map(String::as_str),
        text: page.text.as_deref(),
        canonical: page.canonical.as_deref(),
        lang: page.lang.as_deref(),
        word_count: page.word_count as f64,
        images_total: page.images_total as f64,
        images_missing_alt: page.images_missing_alt as f64,
        inlinks: page.inlinks as f64,
        schema_types: &page.schema_types,
        links: all_links,
        extraction_names: extractions,
    }
}

/// Run every pack's custom audit checks over the crawled pages and merge the
/// findings into the report as real issues (with their guidance), so agency
/// standards appear exactly like built-in rules — in the Issues tab, Top
/// Fixes, the health score, exports, and crawl comparisons.
fn apply_checks(parsed: &[RulePack], result: &mut CrawlResult) {
    if parsed.iter().all(|p| p.checks.is_empty()) {
        return;
    }
    let severity = |s: CheckSeverity| match s {
        CheckSeverity::Error => Severity::Error,
        CheckSeverity::Warning => Severity::Warning,
        CheckSeverity::Notice => Severity::Notice,
    };
    let mut issues: Vec<Issue> = Vec::new();
    for page in &result.pages {
        if page.status != 200 {
            continue;
        }
        let all_links: Vec<String> = page
            .internal_links
            .iter()
            .chain(page.external_links.iter())
            .cloned()
            .collect();
        let extractions: Vec<String> = page
            .extractions
            .iter()
            .filter(|e| !e.values.is_empty())
            .map(|e| e.name.clone())
            .collect();
        let facts = page_facts(page, &all_links, &extractions);
        for pack in parsed {
            for f in pack.check_page(&facts) {
                issues.push(Issue {
                    rule: format!("custom:{}", f.rule),
                    title: f.title,
                    category: Category::Custom,
                    severity: severity(f.severity),
                    url: f.url,
                    detail: Some(f.detail),
                });
            }
        }
    }
    let infos: Vec<RuleInfo> = parsed
        .iter()
        .flat_map(|p| p.check_infos())
        .map(|c| RuleInfo {
            rule: format!("custom:{}", c.rule),
            title: c.title,
            category: Category::Custom,
            severity: match CheckSeverity::parse(c.severity) {
                Some(s) => severity(s),
                None => Severity::Warning,
            },
            why: c.why,
            how_to_fix: c.how_to_fix,
            impact: c.impact,
        })
        .collect();
    crawlie_core::scoring::apply_custom_issues(result, issues, infos);
}

/// Evaluate each pack's content rules against every crawled page's text;
/// returns a JSON summary (per-URL ledgers + aggregate) grafted onto the
/// report as `packs`.
fn evaluate_packs(parsed: &[RulePack], result: &CrawlResult) -> Value {
    if parsed.iter().all(|p| p.rules.is_empty()) {
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

/// Validate a pack and dry-run its custom checks against supplied pages —
/// powers the dashboard's rule builder ("test against your last crawl")
/// without saving anything or crawling.
#[derive(Deserialize)]
struct PreviewRequest {
    source: String,
    #[serde(default)]
    pages: Vec<Page>,
}

async fn preview_handler(Json(req): Json<PreviewRequest>) -> Json<Value> {
    const FINDING_CAP: usize = 200;
    match load("preview", &req.source) {
        Err(e) => Json(json!({ "ok": false, "error": e })),
        Ok(pack) => {
            let mut findings = Vec::new();
            'outer: for page in req.pages.iter().filter(|p| p.status == 200) {
                let all_links: Vec<String> = page
                    .internal_links
                    .iter()
                    .chain(page.external_links.iter())
                    .cloned()
                    .collect();
                let extractions: Vec<String> = page
                    .extractions
                    .iter()
                    .filter(|e| !e.values.is_empty())
                    .map(|e| e.name.clone())
                    .collect();
                let facts = page_facts(page, &all_links, &extractions);
                for f in pack.check_page(&facts) {
                    findings.push(json!({
                        "rule": f.rule,
                        "title": f.title,
                        "severity": f.severity,
                        "url": f.url,
                        "detail": f.detail,
                    }));
                    if findings.len() >= FINDING_CAP {
                        break 'outer;
                    }
                }
            }
            Json(json!({
                "ok": true,
                "checks": pack.checks.len(),
                "contentRules": pack.rules.len(),
                "pagesTested": req.pages.len(),
                "findings": findings,
            }))
        }
    }
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
            Ok(mut result) => {
                let parsed: Vec<RulePack> = req
                    .packs
                    .iter()
                    .filter_map(|p| load(&p.name, &p.source).ok())
                    .collect();
                // Custom audit checks first (they mutate issues + summary),
                // then the content-rule ledgers grafted alongside.
                apply_checks(&parsed, &mut result);
                let packs = evaluate_packs(&parsed, &result);
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
    let jobs: Jobs = Arc::new(Mutex::new(HashMap::new()));
    let app = Router::new()
        // Job-based crawl (interactive): decoupled from the request lifetime.
        .route("/start", post(start_handler))
        .route("/status", get(status_handler))
        .route("/finalize", post(finalize_handler))
        .route("/cancel", post(cancel_handler))
        // Streaming crawl (scheduled/cron path) + rule-builder preview.
        .route("/crawl", post(crawl_handler))
        .route("/preview", post(preview_handler))
        .route("/health", get(|| async { "ok" }))
        .with_state(jobs);

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
