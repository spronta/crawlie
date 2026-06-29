//! Render a crawl result to a single self-contained HTML file — no external
//! assets, no server. Styled in the Geist spirit and *educational*: every issue
//! group explains why it matters and how to fix it. Shareable as one file.

use crate::knowledge::rule_info;
use crate::types::{CrawlResult, Severity};
use std::collections::BTreeMap;

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn sev_class(s: Severity) -> &'static str {
    match s {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Notice => "notice",
        Severity::Good => "good",
    }
}

fn sev_rank(s: Severity) -> u8 {
    match s {
        Severity::Error => 3,
        Severity::Warning => 2,
        Severity::Notice => 1,
        Severity::Good => 0,
    }
}

/// Render the full report as an HTML document string.
pub fn render(r: &CrawlResult) -> String {
    let s = &r.summary;

    // group issues by rule
    struct G {
        title: String,
        severity: Severity,
        count: usize,
        urls: Vec<(String, Option<String>)>,
    }
    let mut groups: BTreeMap<String, G> = BTreeMap::new();
    for i in &r.issues {
        let g = groups.entry(i.rule.clone()).or_insert_with(|| G {
            title: i.title.clone(),
            severity: i.severity,
            count: 0,
            urls: Vec::new(),
        });
        g.count += 1;
        if g.urls.len() < 100 {
            g.urls.push((i.url.clone(), i.detail.clone()));
        }
    }
    let mut ordered: Vec<(String, G)> = groups.into_iter().collect();
    ordered.sort_by(|a, b| {
        sev_rank(b.1.severity)
            .cmp(&sev_rank(a.1.severity))
            .then(b.1.count.cmp(&a.1.count))
    });

    let mut issues_html = String::new();
    for (rule, g) in &ordered {
        let info = rule_info(rule);
        let why = info.as_ref().map(|i| esc(&i.why)).unwrap_or_default();
        let how = info
            .as_ref()
            .map(|i| esc(&i.how_to_fix))
            .unwrap_or_default();
        let impact = info.as_ref().map(|i| esc(&i.impact)).unwrap_or_default();
        let mut urls = String::new();
        for (u, d) in &g.urls {
            let detail = d
                .as_ref()
                .map(|x| format!("<span class=\"d\">{}</span>", esc(x)))
                .unwrap_or_default();
            urls.push_str(&format!(
                "<div class=\"u\"><span>{}</span>{}</div>",
                esc(u),
                detail
            ));
        }
        if g.count > g.urls.len() {
            urls.push_str(&format!(
                "<div class=\"u more\">+ {} more</div>",
                g.count - g.urls.len()
            ));
        }
        let edu = if info.is_some() {
            format!(
                "<div class=\"edu\"><div><b>Why it matters</b><p>{why}</p></div><div><b>How to fix</b><p>{how}</p></div><div><b>If ignored</b><p>{impact}</p></div></div>"
            )
        } else {
            String::new()
        };
        issues_html.push_str(&format!(
            "<details class=\"grp {sev}\"><summary><span class=\"badge {sev}\">{sevlabel}</span><span class=\"gt\">{title}</span><span class=\"ct\">{count}</span></summary>{edu}<div class=\"urls\">{urls}</div></details>",
            sev = sev_class(g.severity),
            sevlabel = g.severity.label(),
            title = esc(&g.title),
            count = g.count,
        ));
    }

    // status table
    let mut status_rows = String::new();
    for (code, n) in &s.by_status {
        status_rows.push_str(&format!(
            "<tr><td class=\"mono\">{}</td><td class=\"mono num\">{}</td></tr>",
            esc(code),
            n
        ));
    }

    let date = crate::timefmt::format_utc(r.started_at);

    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>crawlie report — {host}</title>
<style>{css}</style></head>
<body><div class="wrap">
<header><div class="logo"><span class="mark">◎</span> crawlie <span class="by">by Spronta</span></div><div class="meta">{url}<br><span class="muted">{date}</span></div></header>

<section class="scores">
  <div class="score big"><div class="k">Health</div><div class="v">{health}<small>/100</small></div></div>
  <div class="score big geo"><div class="k">GEO readiness</div><div class="v">{geo}<small>/100</small></div></div>
  <div class="score big a11y"><div class="k">Accessibility</div><div class="v">{a11y}<small>/100</small></div></div>
  <div class="score"><div class="k">Pages</div><div class="v">{pages}</div></div>
  <div class="score"><div class="k">Errors</div><div class="v e">{errors}</div></div>
  <div class="score"><div class="k">Warnings</div><div class="v w">{warnings}</div></div>
  <div class="score"><div class="k">Notices</div><div class="v">{notices}</div></div>
  <div class="score"><div class="k">Indexable</div><div class="v">{indexable}</div></div>
  <div class="score"><div class="k">Avg response</div><div class="v">{avg}ms</div></div>
</section>

<h2>Issues</h2>
<p class="muted">Grouped by type, most severe first. Expand any issue to learn why it matters and how to fix it.</p>
<div class="issues">{issues}</div>

<h2>Status codes</h2>
<table class="status"><thead><tr><th>Code</th><th class="num">Count</th></tr></thead><tbody>{status_rows}</tbody></table>

<footer>Generated by <b>crawlie</b> · the open-source SEO + GEO crawler · by Spronta</footer>
</div></body></html>"#,
        host = esc(&host_of(&r.config.url)),
        url = esc(&r.config.url),
        css = CSS,
        date = esc(&date),
        health = s.health_score,
        geo = s.geo_score,
        a11y = s.a11y_score,
        pages = s.total_pages,
        errors = s.errors,
        warnings = s.warnings,
        notices = s.notices,
        indexable = s.indexable_pages,
        avg = s.avg_response_ms,
        issues = issues_html,
        status_rows = status_rows,
    )
}

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| url.to_string())
}

const CSS: &str = r#"
:root{--bg:#fff;--fg:#171717;--mut:#666;--bd:#ebebeb;--blue:#006bff;--red:#e5484d;--amber:#a05e00;--green:#157a4d;--card:#fafafa}
*{box-sizing:border-box}
body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:var(--fg);background:#f6f6f6}
.wrap{max-width:980px;margin:0 auto;padding:40px 24px 80px;background:var(--bg)}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--bd);padding-bottom:20px;margin-bottom:28px}
.logo{font-weight:600;font-size:20px;letter-spacing:-.02em}
.logo .mark{display:inline-grid;place-items:center;width:24px;height:24px;background:var(--fg);color:#fff;border-radius:6px;margin-right:6px;vertical-align:middle}
.logo .by{font-size:12px;color:var(--mut);font-weight:400}
.meta{text-align:right;font-size:13px;font-family:ui-monospace,Menlo,monospace}
.muted{color:var(--mut)}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:36px}
.score{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px}
.score.big{grid-column:span 2}
.score .k{font-size:13px;color:var(--mut)}
.score .v{font-size:30px;font-weight:600;margin-top:4px;letter-spacing:-.02em}
.score .v small{font-size:14px;color:var(--mut);font-weight:400}
.score .v.e{color:var(--red)}.score .v.w{color:var(--amber)}
.score.geo .v{color:var(--blue)}
.score.a11y .v{color:var(--green)}
h2{font-size:20px;letter-spacing:-.01em;margin:32px 0 4px}
.issues{margin-top:16px}
.grp{border:1px solid var(--bd);border-radius:12px;margin-bottom:10px;overflow:hidden;background:#fff}
.grp summary{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;list-style:none}
.grp summary::-webkit-details-marker{display:none}
.gt{flex:1;font-weight:500}
.ct{font-family:ui-monospace,Menlo,monospace;color:var(--mut);font-size:13px}
.badge{font-size:12px;font-weight:500;padding:2px 9px;border-radius:999px;border:1px solid}
.badge.error{color:var(--red);background:#fff5f5;border-color:#f5d2d3}
.badge.warning{color:var(--amber);background:#fff8ec;border-color:#f7e3bd}
.badge.notice{color:var(--mut);background:#f2f2f2;border-color:var(--bd)}
.badge.good{color:var(--green);background:#ecf8f1;border-color:#c8e9d6}
.edu{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:4px 18px 16px;border-top:1px solid var(--bd);background:var(--card)}
.edu b{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.edu p{margin:6px 0 0;font-size:13.5px}
.urls{padding:8px 18px 16px;border-top:1px solid var(--bd);max-height:340px;overflow:auto}
.urls .u{display:flex;justify-content:space-between;gap:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--mut);padding:4px 0}
.urls .u .d{white-space:nowrap;color:#999}
.urls .more{color:#aaa}
table.status{border-collapse:collapse;width:280px;margin-top:12px}
table.status th,table.status td{border:1px solid var(--bd);padding:6px 12px;text-align:left;font-size:13px}
.num{text-align:right}.mono{font-family:ui-monospace,Menlo,monospace}
footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--bd);color:var(--mut);font-size:13px;text-align:center}
@media(prefers-color-scheme:dark){
  body{background:#000;color:#ededed}
  :root{--bg:#0a0a0a;--fg:#ededed;--mut:#a1a1a1;--bd:#242424;--card:#111}
  .wrap{background:#0a0a0a}.grp{background:#0e0e0e}
  .badge.error{background:#2a1416}.badge.warning{background:#2a1f0d}.badge.notice{background:#1a1a1a}.badge.good{background:#0d2419}
}
"#;
