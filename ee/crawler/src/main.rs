// Crawlie Cloud hosted-crawl service.
//
// Copyright (c) 2026 Spronta Ltd. Licensed under the Crawlie Enterprise Edition
// License (see ee/LICENSE) — NOT the repo's MIT license.
//
// A thin HTTP wrapper around the MIT crawlie-core engine, run inside a
// Cloudflare Container. Crawls run as **out-of-core jobs**: every fetched page
// streams straight to a SQLite store on the container's disk, so a crawl of
// hundreds of thousands of pages holds compact metadata in RAM — never the
// corpus. A finished job is served as artifacts, all bounded in size:
//
//   GET /result/meta   — the lean report (summary, rollup, capped issues)
//   GET /result/index  — compact per-page index rows (list-view fields)
//   GET /result/pages  — full Page records, one chunk (offset/limit) at a time
//
// The crawlie.app Worker's Durable Object polls /status and, on completion,
// streams these artifacts chunk-by-chunk into R2 — nothing ever buffers a
// whole big report in one place.

use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use crawlie_core::pagestore::PageStore;
use crawlie_core::types::{Category, Issue, Page, RuleInfo, Severity};
use crawlie_core::{
    crawl, crawl_to_store, rollup_issues, types::CrawlConfig, types::CrawlEvent,
    types::CrawlResult, CancelToken,
};
use crawlie_rules::{load, CheckSeverity, PageFacts, RulePack};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

/// Pages per chunk served by `/result/pages` and referenced by the index.
/// ~200 full Page records ≈ a few MB of JSON — small enough to buffer
/// anywhere in the pipeline, large enough to keep round-trips low.
const PAGE_CHUNK_SIZE: usize = 200;
/// Sample findings kept per rule in the lean report's rollup.
const ROLLUP_SAMPLE_CAP: usize = 100;
/// A lean report inlines the full issue list up to this many rows; larger
/// crawls ship the rollup samples instead (with `issuesTruncated: true`).
const ISSUE_INLINE_CAP: usize = 20_000;
/// Per-URL content-rule ledgers kept in the report's `packs.byUrl` (the
/// aggregate score/pagesFlagged stay exact regardless).
const PACK_URL_CAP: usize = 2_000;

fn jobs_dir() -> PathBuf {
    std::env::temp_dir().join("crawlie-jobs")
}

fn store_path(job_id: &str) -> PathBuf {
    // Job ids are UUIDs minted by the Worker; sanitize anyway.
    let safe: String = job_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    jobs_dir().join(format!("{safe}.db"))
}

fn remove_store(path: &PathBuf) {
    let _ = std::fs::remove_file(path);
    for ext in ["-wal", "-shm"] {
        let mut p = path.as_os_str().to_os_string();
        p.push(ext);
        let _ = std::fs::remove_file(p);
    }
}

// ---------------------------------------------------------------------------
// Job registry — the crawl runs as a background task keyed by jobId so its
// lifetime is decoupled from any HTTP request. The Worker starts a job, then
// polls /status; the crawl survives however long a large site takes because no
// single request is held open. One container instance handles one job (the
// Worker keys the instance by jobId), so the map holds ~one entry.
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
    /// The lean report JSON (no pages; rollup + capped issues). Small even for
    /// six-figure crawls; kept until the Worker persists it.
    lean: Option<Value>,
    /// Small scalar summary for /status (the Worker's D1 row + progress UI).
    summary: Option<Value>,
    /// Where the crawl's SQLite store lives on disk.
    store: PathBuf,
    /// Total pages stored (drives chunk math without opening the store).
    page_count: usize,
    error: Option<String>,
    /// Set once the Worker has saved the report to R2/D1 (exactly-once guard).
    report_id: Option<String>,
    cancel: CancelToken,
}

type Jobs = Arc<Mutex<HashMap<String, Job>>>;

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

/// Custom-check findings for one page (shared by the in-memory and streaming
/// paths).
fn check_page_issues(parsed: &[RulePack], page: &Page, issues: &mut Vec<Issue>) {
    if page.status != 200 {
        return;
    }
    let severity = |s: CheckSeverity| match s {
        CheckSeverity::Error => Severity::Error,
        CheckSeverity::Warning => Severity::Warning,
        CheckSeverity::Notice => Severity::Notice,
    };
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

/// Guidance records for every pack check (grafted into `custom_rules`).
fn check_infos(parsed: &[RulePack]) -> Vec<RuleInfo> {
    let severity = |s: CheckSeverity| match s {
        CheckSeverity::Error => Severity::Error,
        CheckSeverity::Warning => Severity::Warning,
        CheckSeverity::Notice => Severity::Notice,
    };
    parsed
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
        .collect()
}

/// One page's content-rule evaluation folded into the packs aggregate.
#[derive(Default)]
struct PackAgg {
    total: f64,
    pages_flagged: usize,
    by_url: serde_json::Map<String, Value>,
    truncated: bool,
}

impl PackAgg {
    fn add(&mut self, parsed: &[RulePack], page: &Page) {
        let text = page.text.as_deref().unwrap_or("");
        if text.is_empty() {
            return;
        }
        let ledgers: Vec<_> = parsed
            .iter()
            .map(|pack| pack.evaluate(text))
            .filter(|l| !l.hits.is_empty())
            .collect();
        if ledgers.is_empty() {
            return;
        }
        let page_score: f64 = ledgers.iter().map(|l| l.score).sum();
        self.total += page_score;
        self.pages_flagged += 1;
        if self.by_url.len() < PACK_URL_CAP {
            self.by_url.insert(
                page.url.clone(),
                json!({ "score": page_score, "ledgers": ledgers }),
            );
        } else {
            self.truncated = true;
        }
    }

    fn finish(self, parsed: &[RulePack]) -> Value {
        if parsed.iter().all(|p| p.rules.is_empty()) {
            return Value::Null;
        }
        json!({
            "totalScore": self.total,
            "pagesFlagged": self.pages_flagged,
            "packNames": parsed.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
            "byUrl": self.by_url,
            "byUrlTruncated": self.truncated,
        })
    }
}

/// Turn a finished out-of-core crawl into the artifacts a big report needs:
/// stream every stored page once to evaluate rule packs (custom checks +
/// content rules), then build the lean report JSON (rollup + capped issues,
/// no pages).
fn finalize_store_report(
    mut result: CrawlResult,
    store: &PageStore,
    packs: &[PackSrc],
) -> (Value, Value) {
    let parsed: Vec<RulePack> = packs
        .iter()
        .filter_map(|p| load(&p.name, &p.source).ok())
        .collect();

    // One streaming pass over the corpus for both pack surfaces.
    let has_checks = parsed.iter().any(|p| !p.checks.is_empty());
    let has_rules = parsed.iter().any(|p| !p.rules.is_empty());
    let mut custom_issues: Vec<Issue> = Vec::new();
    let mut agg = PackAgg::default();
    if has_checks || has_rules {
        let _ = store.for_each_page(|_, page| {
            if has_checks {
                check_page_issues(&parsed, &page, &mut custom_issues);
            }
            if has_rules {
                agg.add(&parsed, &page);
            }
        });
    }
    let packs_json = agg.finish(&parsed);
    if has_checks {
        let infos = check_infos(&parsed);
        crawlie_core::scoring::apply_custom_issues(&mut result, custom_issues, infos);
    }

    // Lean report: exact per-rule counts via the rollup; the raw issue list is
    // inlined only while it stays a sane size.
    let rollup = rollup_issues(&result.issues, ROLLUP_SAMPLE_CAP);
    let truncated = result.issues.len() > ISSUE_INLINE_CAP;
    if truncated {
        result.issues = rollup.iter().flat_map(|r| r.sample.clone()).collect();
    }

    let summary = json!({
        "totalPages": result.summary.total_pages,
        "errors": result.summary.errors,
        "warnings": result.summary.warnings,
        "healthScore": result.summary.health_score,
        "geoScore": result.summary.geo_score,
        "a11yScore": result.summary.a11y_score,
        "startedAt": result.started_at,
        "url": result.config.url,
        "packScore": packs_json.get("totalScore").cloned().unwrap_or(Value::Null),
    });

    let mut rv = serde_json::to_value(&result).unwrap_or_else(|_| json!({}));
    if let Value::Object(ref mut m) = rv {
        m.insert("packs".into(), packs_json);
        m.insert(
            "issueRollup".into(),
            serde_json::to_value(&rollup).unwrap_or(Value::Null),
        );
        m.insert("issuesTruncated".into(), Value::Bool(truncated));
        m.insert(
            "pageChunkSize".into(),
            Value::from(PAGE_CHUNK_SIZE),
        );
        m.insert(
            "pageCount".into(),
            Value::from(result.summary.total_pages),
        );
    }
    (rv, summary)
}

/// The background crawl task: streams pages to the on-disk store, keeps
/// progress in the job, then records the lean report — without ever holding
/// the corpus (or the full report JSON) in memory.
async fn run_job(jobs: Jobs, job_id: String, config: CrawlConfig, packs: Vec<PackSrc>) {
    let (cancel, path) = {
        let m = jobs.lock().unwrap();
        match m.get(&job_id) {
            Some(j) => (j.cancel.clone(), j.store.clone()),
            None => return,
        }
    };
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

    let outcome = crawl_to_store(config, &path, on_event, cancel).await;
    // Compute the lean report outside the lock (pack evaluation streams the
    // whole store).
    let (status, lean, summary, page_count, error) = match outcome {
        Ok((result, store)) => {
            let pages = result.summary.total_pages;
            let (lean, summary) = finalize_store_report(result, &store, &packs);
            ("done", Some(lean), Some(summary), pages, None)
        }
        Err(e) => ("error", None, None, 0, Some(e.to_string())),
    };
    if let Ok(mut m) = jobs.lock() {
        if let Some(j) = m.get_mut(&job_id) {
            j.status = status;
            j.lean = lean;
            j.summary = summary;
            j.page_count = page_count;
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
                lean: None,
                summary: None,
                store: store_path(&job_id),
                page_count: 0,
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

/// `GET /status?job=…` — snapshot a job. A `done` job advertises its artifact
/// shape (page count + chunk size) and scalar summary; the report itself is
/// pulled via the `/result/*` endpoints, chunk by chunk.
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
            "done" => json!({
                "status": "done",
                "summary": j.summary,
                "pageCount": j.page_count,
                "pageChunkSize": PAGE_CHUNK_SIZE,
            }),
            "saved" => json!({ "status": "saved", "reportId": j.report_id }),
            "error" => json!({ "status": "error", "message": j.error }),
            other => json!({ "status": other }),
        },
    };
    Json(out)
}

/// `GET /result/meta?job=…` — the lean report JSON (no pages).
async fn result_meta_handler(
    State(jobs): State<Jobs>,
    Query(q): Query<JobQuery>,
) -> Result<Json<Value>, StatusCode> {
    let m = jobs.lock().unwrap();
    match m.get(&q.job).and_then(|j| j.lean.clone()) {
        Some(v) => Ok(Json(v)),
        None => Err(StatusCode::NOT_FOUND),
    }
}

#[derive(Deserialize)]
struct PagesQuery {
    job: String,
    #[serde(default)]
    offset: usize,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    PAGE_CHUNK_SIZE
}

/// Open a done job's store for reading (status must be done/saved-pending).
fn open_job_store(jobs: &Jobs, job_id: &str) -> Result<PageStore, StatusCode> {
    let path = {
        let m = jobs.lock().unwrap();
        let j = m.get(job_id).ok_or(StatusCode::NOT_FOUND)?;
        if j.status != "done" {
            return Err(StatusCode::CONFLICT);
        }
        j.store.clone()
    };
    PageStore::open(&path).map_err(|_| StatusCode::NOT_FOUND)
}

/// Gzip a JSON payload into a response the Worker can pass through **without
/// workerd transparently decompressing it**: the marker travels in
/// `x-crawlie-gzip` (not `Content-Encoding`), so the Durable Object receives
/// the raw gzip bytes and stores them in R2 as-is (~10x smaller, ~10x less
/// transfer). Browsers then decompress natively when the Worker serves the
/// object back with a real `Content-Encoding: gzip` header.
fn gzip_json_response(json: &[u8]) -> Response {
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;
    let mut enc = GzEncoder::new(Vec::with_capacity(json.len() / 6), Compression::default());
    let body = match enc.write_all(json).and_then(|()| enc.finish()) {
        Ok(gz) => gz,
        Err(_) => json.to_vec(), // fall back to identity, marker omitted below
    };
    let gzipped = body.starts_with(&[0x1f, 0x8b]);
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json");
    if gzipped {
        b = b.header("x-crawlie-gzip", "1");
    }
    b.body(Body::from(body)).expect("valid response")
}

/// `GET /result/pages?job=…&offset=…&limit=…` — one chunk of full Page
/// records. The stored blobs are already each page's final JSON, so the chunk
/// is a comma-join (zero serde), then gzipped.
async fn result_pages_handler(
    State(jobs): State<Jobs>,
    Query(q): Query<PagesQuery>,
) -> Result<Response, StatusCode> {
    let store = open_job_store(&jobs, &q.job)?;
    let limit = q.limit.clamp(1, 1_000);
    let blobs = store
        .blobs_slice(q.offset, limit)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut json = Vec::with_capacity(blobs.iter().map(|b| b.len() + 1).sum::<usize>() + 2);
    json.push(b'[');
    for (i, b) in blobs.iter().enumerate() {
        if i > 0 {
            json.push(b',');
        }
        json.extend_from_slice(b.as_bytes());
    }
    json.push(b']');
    Ok(gzip_json_response(&json))
}

/// `GET /result/index?job=…` — the compact page index (one small row per
/// page, tagged with its chunk number), gzipped.
async fn result_index_handler(
    State(jobs): State<Jobs>,
    Query(q): Query<JobQuery>,
) -> Result<Response, StatusCode> {
    let store = open_job_store(&jobs, &q.job)?;
    let index = store
        .page_index(PAGE_CHUNK_SIZE)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let json = serde_json::to_vec(&index).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(gzip_json_response(&json))
}

/// `POST /finalize {job, reportId}` — mark a job saved. Exactly-once: only the
/// first call sets the report id and returns `first: true`. Frees the lean
/// report and deletes the on-disk store.
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
            j.lean = None;
            remove_store(&j.store);
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

/// Run every pack's custom audit checks over an in-memory result and merge
/// the findings as real issues (legacy /crawl path).
fn apply_checks(parsed: &[RulePack], result: &mut CrawlResult) {
    if parsed.iter().all(|p| p.checks.is_empty()) {
        return;
    }
    let mut issues: Vec<Issue> = Vec::new();
    for page in &result.pages {
        check_page_issues(parsed, page, &mut issues);
    }
    let infos = check_infos(parsed);
    crawlie_core::scoring::apply_custom_issues(result, issues, infos);
}

/// Evaluate each pack's content rules against every crawled page's text
/// (legacy /crawl path — pages already in memory).
fn evaluate_packs(parsed: &[RulePack], result: &CrawlResult) -> Value {
    let mut agg = PackAgg::default();
    for page in &result.pages {
        agg.add(parsed, page);
    }
    agg.finish(parsed)
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
            let packs = [pack];
            let mut findings: Vec<Issue> = Vec::new();
            for page in req.pages.iter() {
                check_page_issues(&packs, page, &mut findings);
                if findings.len() >= FINDING_CAP {
                    findings.truncate(FINDING_CAP);
                    break;
                }
            }
            let findings: Vec<Value> = findings
                .into_iter()
                .map(|f| {
                    json!({
                        "rule": f.rule.trim_start_matches("custom:"),
                        "title": f.title,
                        "severity": f.severity,
                        "url": f.url,
                        "detail": f.detail,
                    })
                })
                .collect();
            Json(json!({
                "ok": true,
                "checks": packs[0].checks.len(),
                "contentRules": packs[0].rules.len(),
                "pagesTested": req.pages.len(),
                "findings": findings,
            }))
        }
    }
}

/// Legacy streaming crawl (kept for older Workers): in-memory crawl, progress
/// as NDJSON lines, then one final result line. Big crawls should use the job
/// endpoints instead.
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
    // A container restart orphans any previous job's store; start clean.
    let _ = std::fs::remove_dir_all(jobs_dir());
    let _ = std::fs::create_dir_all(jobs_dir());

    let jobs: Jobs = Arc::new(Mutex::new(HashMap::new()));
    let app = Router::new()
        // Job-based crawl (interactive + scheduled): out-of-core, decoupled
        // from any request lifetime, served as bounded artifacts.
        .route("/start", post(start_handler))
        .route("/status", get(status_handler))
        .route("/result/meta", get(result_meta_handler))
        .route("/result/pages", get(result_pages_handler))
        .route("/result/index", get(result_index_handler))
        .route("/finalize", post(finalize_handler))
        .route("/cancel", post(cancel_handler))
        // Legacy streaming crawl + rule-builder preview.
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
