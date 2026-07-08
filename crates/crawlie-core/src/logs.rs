//! Server-log analysis: parse access logs (Common/Combined Log Format), pick
//! out search-engine and AI bot traffic, and cross-reference a saved crawl —
//! which URLs do bots actually hit, which crawlable pages do they ignore, and
//! which bot-fetched URLs error or aren't in the crawl at all (log-file
//! orphans). The log-file half of a technical audit that a crawler alone
//! can't see.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

/// One parsed access-log line (only the fields the analysis needs).
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub path: String,
    pub status: u16,
    pub user_agent: String,
}

/// Recognised crawler user agents, grouped by family. Order matters — first
/// match wins.
const BOTS: &[(&str, &str)] = &[
    ("googlebot", "Googlebot"),
    ("bingbot", "Bingbot"),
    ("yandex", "YandexBot"),
    ("baiduspider", "Baiduspider"),
    ("duckduckbot", "DuckDuckBot"),
    ("applebot", "Applebot"),
    ("gptbot", "GPTBot"),
    ("oai-searchbot", "OAI-SearchBot"),
    ("claudebot", "ClaudeBot"),
    ("claude-web", "ClaudeBot"),
    ("perplexitybot", "PerplexityBot"),
    ("ccbot", "CCBot"),
    ("bytespider", "Bytespider"),
    ("ahrefsbot", "AhrefsBot"),
    ("semrushbot", "SemrushBot"),
];

/// Bot family for a user agent, when it's a recognised crawler.
pub fn bot_family(user_agent: &str) -> Option<&'static str> {
    let ua = user_agent.to_ascii_lowercase();
    BOTS.iter()
        .find(|(needle, _)| ua.contains(needle))
        .map(|(_, name)| *name)
}

/// Parse one Common/Combined Log Format line:
/// `IP - - [time] "METHOD /path HTTP/x" status bytes ["referer" "user-agent"]`
pub fn parse_line(line: &str) -> Option<LogEntry> {
    // Split on quotes: [prefix, request, " status bytes ", referer, " ", ua, ...]
    let parts: Vec<&str> = line.split('"').collect();
    if parts.len() < 3 {
        return None;
    }
    let request = parts[1];
    let mut req = request.split_whitespace();
    let _method = req.next()?;
    let target = req.next()?;
    // Strip scheme+host if the log stores absolute URLs; drop query for grouping.
    let path = if let Some(rest) = target.strip_prefix("http") {
        let after = rest.splitn(4, '/').nth(3).map(|p| format!("/{p}"));
        after.unwrap_or_else(|| "/".to_string())
    } else {
        target.to_string()
    };
    let path = path.split('?').next().unwrap_or("/").to_string();
    let status: u16 = parts[2].split_whitespace().next()?.parse().ok()?;
    // The last quoted field is the user agent in Combined format; Common
    // format has none.
    let user_agent = if parts.len() >= 6 {
        parts[parts.len() - 2].to_string()
    } else {
        String::new()
    };
    Some(LogEntry {
        path,
        status,
        user_agent,
    })
}

/// Aggregated log-file analysis. All URL lists are paths, capped and sorted by
/// hit count where applicable.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogAnalysis {
    pub total_lines: usize,
    pub parsed_lines: usize,
    pub bot_hits: usize,
    /// Hits per recognised bot family.
    pub by_bot: BTreeMap<String, usize>,
    /// Status class counts for bot traffic ("2xx", "3xx", ...).
    pub bot_status: BTreeMap<String, usize>,
    /// Most-crawled paths by bots: (path, hits).
    pub top_paths: Vec<(String, usize)>,
    /// Paths bots hit that returned 4xx/5xx: (path, status, hits).
    pub bot_errors: Vec<(String, u16, usize)>,
    /// Bot-hit paths that are NOT in the supplied crawl — log-file orphans.
    pub orphans: Vec<String>,
    /// Crawled, indexable paths that bots never visited in this log window.
    pub never_crawled_by_bots: Vec<String>,
}

const TOP_CAP: usize = 50;

/// Analyze log lines, optionally against the paths of a saved crawl.
pub fn analyze<I: IntoIterator<Item = String>>(
    lines: I,
    crawl_paths: Option<&HashSet<String>>,
) -> LogAnalysis {
    let mut a = LogAnalysis::default();
    let mut path_hits: HashMap<String, usize> = HashMap::new();
    let mut error_hits: HashMap<(String, u16), usize> = HashMap::new();
    let mut bot_paths: HashSet<String> = HashSet::new();

    for line in lines {
        a.total_lines += 1;
        let Some(e) = parse_line(&line) else { continue };
        a.parsed_lines += 1;
        let Some(bot) = bot_family(&e.user_agent) else {
            continue;
        };
        a.bot_hits += 1;
        *a.by_bot.entry(bot.to_string()).or_insert(0) += 1;
        *a.bot_status
            .entry(format!("{}xx", e.status / 100))
            .or_insert(0) += 1;
        *path_hits.entry(e.path.clone()).or_insert(0) += 1;
        if e.status >= 400 {
            *error_hits.entry((e.path.clone(), e.status)).or_insert(0) += 1;
        }
        bot_paths.insert(e.path);
    }

    let mut top: Vec<(String, usize)> = path_hits.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    top.truncate(TOP_CAP);
    a.top_paths = top;

    let mut errs: Vec<(String, u16, usize)> = error_hits
        .into_iter()
        .map(|((p, s), n)| (p, s, n))
        .collect();
    errs.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
    errs.truncate(TOP_CAP);
    a.bot_errors = errs;

    if let Some(crawl) = crawl_paths {
        let mut orphans: Vec<String> = bot_paths
            .iter()
            .filter(|p| !crawl.contains(*p))
            .cloned()
            .collect();
        orphans.sort();
        orphans.truncate(TOP_CAP);
        a.orphans = orphans;

        let mut cold: Vec<String> = crawl
            .iter()
            .filter(|p| !bot_paths.contains(*p))
            .cloned()
            .collect();
        cold.sort();
        cold.truncate(TOP_CAP);
        a.never_crawled_by_bots = cold;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINE: &str = r#"66.249.66.1 - - [08/Jul/2026:10:00:00 +0000] "GET /docs/cli?ref=x HTTP/1.1" 200 5120 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)""#;

    #[test]
    fn parses_combined_format_and_detects_bots() {
        let e = parse_line(LINE).unwrap();
        assert_eq!(e.path, "/docs/cli", "query stripped");
        assert_eq!(e.status, 200);
        assert_eq!(bot_family(&e.user_agent), Some("Googlebot"));
        assert_eq!(bot_family("Mozilla/5.0 (Macintosh…) Safari/605.1.15"), None);
    }

    #[test]
    fn analysis_cross_references_a_crawl() {
        let lines = vec![
            LINE.to_string(),
            LINE.replace("/docs/cli?ref=x", "/gone")
                .replace(" 200 ", " 404 "),
            LINE.replace("Googlebot/2.1", "GPTBot/1.0")
                .replace("googlebot", "gptbot"),
            // Human traffic is ignored.
            LINE.replace(
                "Googlebot/2.1; +http://www.google.com/bot.html",
                "Safari/605",
            ),
        ];
        let crawl: HashSet<String> = ["/docs/cli".to_string(), "/pricing".to_string()].into();
        let a = analyze(lines, Some(&crawl));
        assert_eq!(a.total_lines, 4);
        assert_eq!(a.bot_hits, 3);
        assert_eq!(a.by_bot.get("Googlebot"), Some(&2));
        assert_eq!(a.by_bot.get("GPTBot"), Some(&1));
        assert_eq!(a.bot_errors.len(), 1);
        assert_eq!(a.bot_errors[0].1, 404);
        assert_eq!(a.orphans, vec!["/gone".to_string()]);
        assert_eq!(a.never_crawled_by_bots, vec!["/pricing".to_string()]);
    }
}
