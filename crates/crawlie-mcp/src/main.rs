//! crawlie-mcp — a Model Context Protocol server over stdio.
//!
//! Designed so an agent never has to read files or aggregate data itself:
//! responses are compact and pre-digested (scores, GEO gaps, prioritized fixes,
//! issues grouped by rule with sample URLs). Full per-page / per-issue detail is
//! opt-in. Slicing tools operate on saved reports so re-asking never re-crawls.
//!
//! Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. Diagnostics go to
//! stderr so stdout stays pure protocol.

use crawlie_core::{
    all_rules, crawl, geo_gaps, group_issues, rule_info, top_fixes, top_fixes_filtered,
    CancelToken, Category, CrawlConfig, CrawlMode, CrawlResult, ReportStore,
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
            continue;
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
            "description": "Crawl a website and run a full technical SEO + GEO audit. Returns a compact, pre-digested result: a one-line headline, scores, a GEO gap breakdown, the prioritized top fixes, and issues grouped by rule with sample URLs. Auto-saves to history so you can slice it later with top_fixes / affected_urls / geo_gaps without re-crawling. Set includeIssues/includePages for full detail.",
            "inputSchema": { "type": "object", "properties": {
                "url": { "type": "string", "description": "Seed URL (http/https)." },
                "maxPages": { "type": "integer", "default": 200 },
                "maxDepth": { "type": "integer", "default": 16 },
                "concurrency": { "type": "integer", "default": 16 },
                "checkExternal": { "type": "boolean", "default": true },
                "respectRobots": { "type": "boolean", "default": true },
                "useSitemap": { "type": "boolean", "default": true },
                "render": { "type": "boolean", "default": false, "description": "Render each page with headless Chrome before auditing, so JavaScript-injected content, links and meta tags are seen (React/Next/Vue and other client-rendered sites). Surfaces the 'content-requires-js' rule. Slower; requires a Chrome/Chromium/Edge install on the host." },
                "renderWaitMs": { "type": "integer", "default": 0, "description": "Extra settle delay in ms after navigation for late-hydrating content. Only used when render is true." },
                "include": { "type": "array", "items": { "type": "string" } },
                "exclude": { "type": "array", "items": { "type": "string" } },
                "excludeHosts": { "type": "array", "description": "Exclude discovered URLs whose host matches. Each rule is a substring match, or a regex when 'regex' is true. The seed URL is never excluded.", "items": { "type": "object", "properties": { "value": { "type": "string" }, "regex": { "type": "boolean", "default": false } }, "required": ["value"] } },
                "excludePaths": { "type": "array", "description": "Exclude discovered URLs whose path matches (substring or regex), e.g. value '/share'.", "items": { "type": "object", "properties": { "value": { "type": "string" }, "regex": { "type": "boolean", "default": false } }, "required": ["value"] } },
                "extract": { "type": "array", "description": "Custom data extractors run on every page. CSS pulls element text (or the named attribute); regex pulls capture group 1 (else the whole match). Results appear per page under 'extractions' — set includePages to see them.", "items": { "type": "object", "properties": {
                    "name": { "type": "string", "description": "Column name for the values." },
                    "css": { "type": "string", "description": "CSS selector (e.g. '.product-price')." },
                    "attr": { "type": "string", "description": "Attribute to read instead of text (e.g. 'href')." },
                    "regex": { "type": "string", "description": "Regex over raw HTML (instead of css)." }
                }, "required": ["name"] } },
                "includeIssues": { "type": "boolean", "default": false, "description": "Include the full flat issue list (verbose)." },
                "includePages": { "type": "boolean", "default": false, "description": "Include full per-page data (verbose)." },
                "saveReport": { "type": "boolean", "default": true }
            }, "required": ["url"] }
        },
        {
            "name": "audit_url",
            "description": "Fetch and audit a single URL (no crawling). Compact SEO + GEO result.",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] }
        },
        {
            "name": "audit_urls",
            "description": "Audit an explicit list of URLs (no crawling).",
            "inputSchema": { "type": "object", "properties": { "urls": { "type": "array", "items": { "type": "string" } } }, "required": ["urls"] }
        },
        {
            "name": "top_fixes",
            "description": "Return the prioritized fixes for a saved report, optionally scoped to one category (e.g. category='geo' for the top GEO fixes). Operates on the latest report by default — no re-crawl.",
            "inputSchema": { "type": "object", "properties": {
                "reportId": { "type": "string", "description": "Report id, or 'latest' (default)." },
                "category": { "type": "string", "description": "Filter to a category: response, indexability, links, titles-meta, headings, content, images, canonical, security, performance, mobile, international, social, structured-data, geo." },
                "limit": { "type": "integer", "default": 8 }
            } }
        },
        {
            "name": "geo_gaps",
            "description": "GEO gap breakdown for a saved report: how many indexable pages lack each AI-readiness signal (authorship, dates, structured data, semantic HTML, answer-readiness, question headings).",
            "inputSchema": { "type": "object", "properties": { "reportId": { "type": "string", "description": "Report id, or 'latest' (default)." } } }
        },
        {
            "name": "affected_urls",
            "description": "List the URLs affected by a specific rule in a saved report (e.g. rule='geo-no-author').",
            "inputSchema": { "type": "object", "properties": {
                "rule": { "type": "string" },
                "reportId": { "type": "string", "description": "Report id, or 'latest' (default)." },
                "limit": { "type": "integer", "default": 100 }
            }, "required": ["rule"] }
        },
        {
            "name": "explain_issue",
            "description": "Explain an audit rule: why it matters for SEO/GEO, how to fix it, and the impact of ignoring it.",
            "inputSchema": { "type": "object", "properties": { "rule": { "type": "string" } }, "required": ["rule"] }
        },
        {
            "name": "list_rules",
            "description": "List every audit rule crawlie checks, with category, severity, and a one-line summary.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_reports",
            "description": "List previously saved crawl reports (id, url, scores).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_report",
            "description": "Load a saved crawl report (compact by default; set includeIssues/includePages for full detail).",
            "inputSchema": { "type": "object", "properties": {
                "id": { "type": "string" },
                "includeIssues": { "type": "boolean", "default": false },
                "includePages": { "type": "boolean", "default": false }
            }, "required": ["id"] }
        },
        {
            "name": "diff_reports",
            "description": "Compare two saved crawls of the same site (crawl-over-crawl trend). Returns health/GEO score deltas, pages added/removed, and issues that newly appeared or were resolved (grouped by rule). Use it to verify fixes landed or catch regressions between crawls.",
            "inputSchema": { "type": "object", "properties": {
                "oldId": { "type": "string", "description": "The earlier report id." },
                "newId": { "type": "string", "description": "The later report id, or 'latest' (default)." }
            }, "required": ["oldId"] }
        }
    ] })
}

fn load_report_or_latest(id: Option<&str>) -> Option<CrawlResult> {
    let store = ReportStore::new(reports_dir());
    match id {
        Some(id) if id != "latest" => store.load(id),
        _ => {
            let latest = store.list().into_iter().next()?;
            store.load(&latest.id)
        }
    }
}

fn parse_category(args: &Value) -> Option<Category> {
    args.get("category")
        .and_then(|v| serde_json::from_value::<Category>(v.clone()).ok())
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
            let include_issues = args
                .get("includeIssues")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let save = args
                .get("saveReport")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let mut config: CrawlConfig =
                serde_json::from_value(args).map_err(|e| format!("invalid arguments: {e}"))?;
            if config.max_pages == 0 {
                config.max_pages = 200;
            }
            run(config, include_pages, include_issues, save).await
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
            run(config, true, true, false).await
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
            run(config, true, true, false).await
        }
        "top_fixes" => {
            let id = args.get("reportId").and_then(|v| v.as_str());
            let report =
                load_report_or_latest(id).ok_or("no saved report found — run crawl_site first")?;
            let category = parse_category(&args);
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(8) as usize;
            text_result(
                serde_json::to_string_pretty(&top_fixes_filtered(&report.issues, category, limit))
                    .unwrap_or_default(),
            )
        }
        "geo_gaps" => {
            let id = args.get("reportId").and_then(|v| v.as_str());
            let report =
                load_report_or_latest(id).ok_or("no saved report found — run crawl_site first")?;
            text_result(serde_json::to_string_pretty(&geo_gaps(&report.pages)).unwrap_or_default())
        }
        "affected_urls" => {
            let rule = args
                .get("rule")
                .and_then(|v| v.as_str())
                .ok_or("missing rule")?
                .to_string();
            let id = args.get("reportId").and_then(|v| v.as_str());
            let report =
                load_report_or_latest(id).ok_or("no saved report found — run crawl_site first")?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
            let urls: Vec<&str> = report
                .issues
                .iter()
                .filter(|i| i.rule == rule)
                .map(|i| i.url.as_str())
                .take(limit)
                .collect();
            let total = report.issues.iter().filter(|i| i.rule == rule).count();
            text_result(
                serde_json::to_string_pretty(
                    &json!({ "rule": rule, "total": total, "urls": urls }),
                )
                .unwrap_or_default(),
            )
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
            let include_issues = args
                .get("includeIssues")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            match ReportStore::new(reports_dir()).load(id) {
                Some(result) => result_payload(&result, include_pages, include_issues),
                None => Err(format!("report '{id}' not found")),
            }
        }
        "diff_reports" => {
            let old_id = args
                .get("oldId")
                .and_then(|v| v.as_str())
                .ok_or("missing oldId")?;
            let store = ReportStore::new(reports_dir());
            // 'latest' (the default) resolves to the newest saved report.
            let new_id = match args.get("newId").and_then(|v| v.as_str()) {
                Some(id) if id != "latest" => id.to_string(),
                _ => store
                    .list()
                    .into_iter()
                    .next()
                    .map(|m| m.id)
                    .ok_or("no saved reports to diff against")?,
            };
            match store.diff(old_id, &new_id).map_err(|e| e.to_string())? {
                Some(diff) => text_result(serde_json::to_string_pretty(&diff).unwrap_or_default()),
                None => Err(format!(
                    "one or both reports not found ('{old_id}', '{new_id}')"
                )),
            }
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

async fn run(
    config: CrawlConfig,
    include_pages: bool,
    include_issues: bool,
    save: bool,
) -> Result<Value, String> {
    let result = crawl(config, |_| {}, CancelToken::new())
        .await
        .map_err(|e| e.to_string())?;
    if save {
        let _ = ReportStore::new(reports_dir()).save(&result);
    }
    result_payload(&result, include_pages, include_issues)
}

fn headline(r: &CrawlResult) -> String {
    let s = &r.summary;
    let lead = top_fixes(&r.issues, 1)
        .first()
        .map(|f| format!("{} ({} affected)", f.title, f.count))
        .unwrap_or_else(|| "no issues".into());
    format!(
        "Health {}/100 · GEO {}/100 · {} pages · {} errors, {} warnings, {} notices. Top fix: {}.",
        s.health_score, s.geo_score, s.total_pages, s.errors, s.warnings, s.notices, lead
    )
}

fn result_payload(
    result: &CrawlResult,
    include_pages: bool,
    include_issues: bool,
) -> Result<Value, String> {
    let mut payload = json!({
        "headline": headline(result),
        "summary": result.summary,
        "geoGaps": geo_gaps(&result.pages),
        "topFixes": top_fixes(&result.issues, 8),
        "issuesByRule": group_issues(&result.issues, 15),
        "robotsFound": result.robots_found,
        "sitemapUrls": result.sitemap_urls,
        "sitemapFound": result.sitemap_found,
        "llmsTxtFound": result.llms_txt_found,
        "pageCount": result.pages.len(),
    });
    if include_issues {
        payload["issues"] = serde_json::to_value(&result.issues).unwrap_or(Value::Null);
    }
    if include_pages {
        payload["pages"] = serde_json::to_value(&result.pages).unwrap_or(Value::Null);
    }
    text_result(serde_json::to_string_pretty(&payload).unwrap_or_default())
}

fn text_result(text: String) -> Result<Value, String> {
    Ok(json!({ "content": [ { "type": "text", "text": text } ], "isError": false }))
}
