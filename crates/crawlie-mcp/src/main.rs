//! crawlie-mcp — a Model Context Protocol server over stdio.
//!
//! Exposes the crawlie engine as agent tools:
//!   - `crawl_site`    — crawl + audit a whole site (SEO + GEO)
//!   - `audit_url`     — audit a single page
//!   - `audit_urls`    — audit an explicit list of pages
//!   - `explain_issue` — why a rule matters and how to fix it
//!   - `list_rules`    — the full rule catalogue
//!   - `list_reports` / `get_report` — saved crawl history
//!
//! Transport is newline-delimited JSON-RPC 2.0 on stdin/stdout. All diagnostics
//! go to stderr so stdout stays pure protocol.

use crawlie_core::{
    all_rules, crawl, rule_info, top_fixes, CancelToken, CrawlConfig, CrawlMode, ReportStore,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const DEFAULT_PROTOCOL: &str = "2024-11-05";

fn reports_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie").join("reports")
}

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    eprintln!("crawlie-mcp v{} ready on stdio", env!("CARGO_PKG_VERSION"));

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("crawlie-mcp: bad json: {e}");
                continue;
            }
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or(Value::Null);
        if id.is_none() {
            continue; // notification
        }
        let id = id.unwrap();

        let response = match method {
            "initialize" => ok(id, initialize(&params)),
            "tools/list" => ok(id, tools_list()),
            "tools/call" => match tools_call(params).await {
                Ok(result) => ok(id, result),
                Err(msg) => err(id, -32603, &msg),
            },
            "ping" => ok(id, json!({})),
            _ => err(id, -32601, &format!("method not found: {method}")),
        };

        let mut buf = serde_json::to_string(&response).unwrap_or_default();
        buf.push('\n');
        if stdout.write_all(buf.as_bytes()).await.is_err() {
            break;
        }
        let _ = stdout.flush().await;
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}
fn err(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn initialize(params: &Value) -> Value {
    let protocol = params
        .get("protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROTOCOL)
        .to_string();
    json!({
        "protocolVersion": protocol,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "crawlie", "version": env!("CARGO_PKG_VERSION") }
    })
}

fn tools_list() -> Value {
    json!({ "tools": [
        {
            "name": "crawl_site",
            "description": "Crawl a website from a seed URL and run a full technical SEO + GEO (Generative Engine Optimization) audit. Respects robots.txt, seeds from sitemap.xml, and returns a health score, a GEO readiness score, per-page data, and grouped issues with severities. Use this for a whole-site audit.",
            "inputSchema": { "type": "object", "properties": {
                "url": { "type": "string", "description": "Seed URL (http/https)." },
                "maxPages": { "type": "integer", "default": 200 },
                "maxDepth": { "type": "integer", "default": 16 },
                "concurrency": { "type": "integer", "default": 16 },
                "checkExternal": { "type": "boolean", "default": true },
                "respectRobots": { "type": "boolean", "default": true },
                "useSitemap": { "type": "boolean", "default": true },
                "include": { "type": "array", "items": { "type": "string" }, "description": "Only crawl URLs matching these globs." },
                "exclude": { "type": "array", "items": { "type": "string" }, "description": "Skip URLs matching these globs." },
                "includePages": { "type": "boolean", "default": false, "description": "Include full per-page data (verbose)." },
                "saveReport": { "type": "boolean", "default": false, "description": "Persist the report to crawlie's local history." }
            }, "required": ["url"] }
        },
        {
            "name": "audit_url",
            "description": "Fetch and audit a single URL (no crawling). Returns that page's SEO + GEO data and issues. Fast way to check one page.",
            "inputSchema": { "type": "object", "properties": {
                "url": { "type": "string" }
            }, "required": ["url"] }
        },
        {
            "name": "audit_urls",
            "description": "Audit an explicit list of URLs (no crawling). Use when you want to check specific pages rather than a whole site.",
            "inputSchema": { "type": "object", "properties": {
                "urls": { "type": "array", "items": { "type": "string" } }
            }, "required": ["urls"] }
        },
        {
            "name": "explain_issue",
            "description": "Explain an audit rule: why it matters for SEO/GEO, how to fix it, and the impact of ignoring it. Pass a rule id from a crawl's issues (e.g. 'title-missing', 'geo-not-answerable').",
            "inputSchema": { "type": "object", "properties": {
                "rule": { "type": "string" }
            }, "required": ["rule"] }
        },
        {
            "name": "list_rules",
            "description": "List every audit rule crawlie checks, with category, severity, and a one-line summary. Useful to understand coverage.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_reports",
            "description": "List previously saved crawl reports (id, url, scores).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_report",
            "description": "Load a previously saved crawl report by id (from list_reports).",
            "inputSchema": { "type": "object", "properties": {
                "id": { "type": "string" },
                "includePages": { "type": "boolean", "default": false }
            }, "required": ["id"] }
        }
    ] })
}

async fn tools_call(params: Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(|n| n.as_str())
        .ok_or("missing tool name")?;
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    match name {
        "crawl_site" => {
            let include_pages = args
                .get("includePages")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let save = args
                .get("saveReport")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut config: CrawlConfig =
                serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))?;
            if config.max_pages == 0 {
                config.max_pages = 200;
            }
            run(config, include_pages, save).await
        }
        "audit_url" => {
            let url = args
                .get("url")
                .and_then(|u| u.as_str())
                .ok_or("missing url")?
                .to_string();
            let mut config = CrawlConfig::new(url);
            config.mode = CrawlMode::Page;
            config.max_depth = 0;
            run(config, true, false).await
        }
        "audit_urls" => {
            let urls: Vec<String> = args
                .get("urls")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .ok_or("missing urls")?;
            if urls.is_empty() {
                return Err("urls must be a non-empty array".into());
            }
            let mut config = CrawlConfig::new(urls[0].clone());
            config.mode = CrawlMode::List;
            config.urls = urls;
            config.max_depth = 0;
            run(config, true, false).await
        }
        "explain_issue" => {
            let rule = args
                .get("rule")
                .and_then(|v| v.as_str())
                .ok_or("missing rule")?;
            match rule_info(rule) {
                Some(info) => text_result(serde_json::to_string_pretty(&info).unwrap_or_default()),
                None => Err(format!("unknown rule '{rule}'")),
            }
        }
        "list_rules" => text_result(serde_json::to_string_pretty(&all_rules()).unwrap_or_default()),
        "list_reports" => {
            let reports = ReportStore::new(reports_dir()).list();
            text_result(serde_json::to_string_pretty(&reports).unwrap_or_default())
        }
        "get_report" => {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("missing id")?;
            let include_pages = args
                .get("includePages")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            match ReportStore::new(reports_dir()).load(id) {
                Some(result) => result_payload(&result, include_pages),
                None => Err(format!("report '{id}' not found")),
            }
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

async fn run(config: CrawlConfig, include_pages: bool, save: bool) -> Result<Value, String> {
    let result = crawl(config, |_| {}, CancelToken::new())
        .await
        .map_err(|e| e.to_string())?;
    if save {
        let _ = ReportStore::new(reports_dir()).save(&result);
    }
    result_payload(&result, include_pages)
}

fn result_payload(
    result: &crawlie_core::CrawlResult,
    include_pages: bool,
) -> Result<Value, String> {
    let mut payload = json!({
        "summary": result.summary,
        "issues": result.issues,
        "topFixes": top_fixes(&result.issues, 8),
        "robotsFound": result.robots_found,
        "sitemapUrls": result.sitemap_urls,
        "llmsTxtFound": result.llms_txt_found,
    });
    if include_pages {
        payload["pages"] = serde_json::to_value(&result.pages).unwrap_or(Value::Null);
    } else {
        payload["pageCount"] = json!(result.pages.len());
    }
    text_result(serde_json::to_string_pretty(&payload).unwrap_or_default())
}

fn text_result(text: String) -> Result<Value, String> {
    Ok(json!({ "content": [ { "type": "text", "text": text } ], "isError": false }))
}
