//! `crawlie` — command-line SEO + GEO crawler.
//!
//! Designed for humans *and* agents. Default output is the full crawl result as
//! JSON on stdout (progress on stderr), so stdout stays a clean machine stream.
//! `--format pretty` for a human report, `--format html` for a shareable file.

use clap::{Parser, Subcommand, ValueEnum};
use crawlie_core::{
    all_rules, crawl, report_html, rule_info, CancelToken, CrawlConfig, CrawlMode, CrawlResult,
    ReportStore, Severity,
};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "crawlie",
    version,
    about = "Fast OSS SEO + GEO crawler by Spronta"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Crawl a whole site and audit every page.
    Crawl(CrawlArgs),
    /// Audit one or more specific URLs (no crawling).
    Audit(AuditArgs),
    /// Explain why a rule matters and how to fix it (or list all rules).
    Explain { rule: Option<String> },
    /// List saved reports.
    Reports,
    /// Print or export a saved report by id.
    Report(ReportArgs),
}

#[derive(Parser)]
struct CrawlArgs {
    /// Seed URL to crawl.
    url: String,
    #[arg(long, default_value_t = 500)]
    max_pages: usize,
    #[arg(long, default_value_t = 16)]
    max_depth: usize,
    #[arg(long, short = 'c', default_value_t = 16)]
    concurrency: usize,
    #[arg(long, default_value_t = 15)]
    timeout: u64,
    /// Skip HEAD-checking external/uncrawled links.
    #[arg(long)]
    no_external: bool,
    /// Ignore robots.txt.
    #[arg(long)]
    no_robots: bool,
    /// Don't seed the crawl from sitemap.xml.
    #[arg(long)]
    no_sitemap: bool,
    /// Only crawl URLs matching this glob (repeatable).
    #[arg(long)]
    include: Vec<String>,
    /// Skip URLs matching this glob (repeatable).
    #[arg(long)]
    exclude: Vec<String>,
    #[arg(long, value_enum, default_value_t = Format::Json)]
    format: Format,
    #[arg(long, value_enum)]
    severity: Option<Sev>,
    /// Write output to a file instead of stdout.
    #[arg(long, short = 'o')]
    output: Option<String>,
    /// Save the report to the local report store.
    #[arg(long)]
    save: bool,
    /// Exit non-zero if findings at or above this severity exist.
    #[arg(long, value_enum, default_value_t = FailOn::None)]
    fail_on: FailOn,
    #[arg(long, short = 'q')]
    quiet: bool,
}

#[derive(Parser)]
struct AuditArgs {
    /// One or more URLs to audit.
    #[arg(required = true)]
    urls: Vec<String>,
    #[arg(long, value_enum, default_value_t = Format::Pretty)]
    format: Format,
    #[arg(long, short = 'o')]
    output: Option<String>,
    #[arg(long, short = 'q')]
    quiet: bool,
}

#[derive(Parser)]
struct ReportArgs {
    /// Report id (see `crawlie reports`).
    id: String,
    #[arg(long, value_enum, default_value_t = Format::Pretty)]
    format: Format,
    #[arg(long, short = 'o')]
    output: Option<String>,
    /// Delete this report instead of printing it.
    #[arg(long)]
    delete: bool,
}

#[derive(Copy, Clone, ValueEnum)]
enum Format {
    Json,
    Pretty,
    Csv,
    Html,
}

#[derive(Copy, Clone, ValueEnum)]
enum Sev {
    Error,
    Warning,
    Notice,
}

#[derive(Copy, Clone, ValueEnum, PartialEq)]
enum FailOn {
    None,
    Error,
    Warning,
}

fn rank(s: Severity) -> u8 {
    match s {
        Severity::Good => 0,
        Severity::Notice => 1,
        Severity::Warning => 2,
        Severity::Error => 3,
    }
}

fn reports_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie").join("reports")
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Crawl(a) => run_crawl(a).await,
        Command::Audit(a) => run_audit(a).await,
        Command::Explain { rule } => explain(rule),
        Command::Reports => list_reports(),
        Command::Report(a) => show_report(a),
    }
}

async fn run_crawl(a: CrawlArgs) -> ExitCode {
    let config = CrawlConfig {
        mode: CrawlMode::Site,
        max_pages: a.max_pages,
        max_depth: a.max_depth,
        concurrency: a.concurrency,
        timeout_secs: a.timeout,
        check_external: !a.no_external,
        respect_robots: !a.no_robots,
        use_sitemap: !a.no_sitemap,
        include: a.include,
        exclude: a.exclude,
        ..CrawlConfig::new(&a.url)
    };
    let min = a.severity.map(sev_rank);
    execute(config, a.format, min, a.output, a.save, a.fail_on, a.quiet).await
}

async fn run_audit(a: AuditArgs) -> ExitCode {
    let first = a.urls.first().cloned().unwrap_or_default();
    let (mode, urls) = if a.urls.len() == 1 {
        (CrawlMode::Page, Vec::new())
    } else {
        (CrawlMode::List, a.urls.clone())
    };
    let config = CrawlConfig {
        mode,
        urls,
        max_depth: 0,
        ..CrawlConfig::new(&first)
    };
    execute(
        config,
        a.format,
        None,
        a.output,
        false,
        FailOn::None,
        a.quiet,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn execute(
    config: CrawlConfig,
    format: Format,
    min: Option<u8>,
    output: Option<String>,
    save: bool,
    fail_on: FailOn,
    quiet: bool,
) -> ExitCode {
    let on_event = move |evt: crawlie_core::CrawlEvent| {
        if quiet {
            return;
        }
        if let crawlie_core::CrawlEvent::Progress {
            crawled,
            queued,
            current,
            ..
        } = evt
        {
            eprint!(
                "\r\x1b[2K  crawled {crawled} · queued {queued} · {}",
                truncate(&current, 56)
            );
            let _ = std::io::stderr().flush();
        }
    };

    let result = match crawl(config, on_event, CancelToken::new()).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("\rcrawlie: {e}");
            return ExitCode::from(2);
        }
    };
    if !quiet {
        eprintln!(
            "\r\x1b[2K  done · {} pages · health {}/100 · GEO {}/100 · {} ms",
            result.summary.total_pages,
            result.summary.health_score,
            result.summary.geo_score,
            result.summary.duration_ms
        );
    }

    if save {
        match ReportStore::new(reports_dir()).save(&result) {
            Ok(meta) => {
                if !quiet {
                    eprintln!("  saved report {}", meta.id)
                }
            }
            Err(e) => eprintln!("  warning: could not save report: {e}"),
        }
    }

    let rendered = render(&result, format, min);
    if let Err(code) = emit(rendered, output, quiet) {
        return code;
    }

    let fail = match fail_on {
        FailOn::None => false,
        FailOn::Error => result.summary.errors > 0,
        FailOn::Warning => result.summary.errors > 0 || result.summary.warnings > 0,
    };
    if fail {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn sev_rank(s: Sev) -> u8 {
    match s {
        Sev::Error => 3,
        Sev::Warning => 2,
        Sev::Notice => 1,
    }
}

fn emit(rendered: String, output: Option<String>, quiet: bool) -> Result<(), ExitCode> {
    match output {
        Some(path) => {
            if let Err(e) = std::fs::write(&path, rendered) {
                eprintln!("crawlie: failed to write {path}: {e}");
                return Err(ExitCode::from(2));
            }
            if !quiet {
                eprintln!("  written to {path}");
            }
        }
        None => println!("{rendered}"),
    }
    Ok(())
}

fn render(r: &CrawlResult, format: Format, min: Option<u8>) -> String {
    match format {
        Format::Json => render_json(r, min),
        Format::Pretty => render_pretty(r, min),
        Format::Csv => render_csv(r, min),
        Format::Html => report_html::render(r),
    }
}

fn filtered<'a>(r: &'a CrawlResult, min: Option<u8>) -> Vec<&'a crawlie_core::Issue> {
    r.issues
        .iter()
        .filter(|i| i.severity != Severity::Good)
        .filter(|i| min.map(|m| rank(i.severity) >= m).unwrap_or(true))
        .collect()
}

fn render_json(r: &CrawlResult, min: Option<u8>) -> String {
    if min.is_none() {
        return serde_json::to_string_pretty(r).unwrap_or_default();
    }
    let issues = filtered(r, min);
    let value = serde_json::json!({
        "config": r.config, "pages": r.pages, "issues": issues, "summary": r.summary,
        "robotsFound": r.robots_found, "sitemapUrls": r.sitemap_urls, "startedAt": r.started_at,
    });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

fn render_csv(r: &CrawlResult, min: Option<u8>) -> String {
    let mut out = String::from("severity,category,rule,title,url,detail\n");
    for i in filtered(r, min) {
        out.push_str(&format!(
            "{},{},{},{},{},{}\n",
            i.severity.label(),
            i.category.label(),
            i.rule,
            csv(&i.title),
            csv(&i.url),
            csv(i.detail.as_deref().unwrap_or("")),
        ));
    }
    out
}

fn render_pretty(r: &CrawlResult, min: Option<u8>) -> String {
    use std::collections::BTreeMap;
    let s = &r.summary;
    let mut out = String::new();
    out.push_str(&format!("\n  crawlie · {}\n", r.config.url));
    out.push_str(&format!("  {}\n", "─".repeat(54)));
    out.push_str(&format!(
        "  Health {}/100   GEO {}/100\n",
        s.health_score, s.geo_score
    ));
    out.push_str(&format!(
        "  {} pages · {} ms · {} indexable · {} duplicate\n",
        s.total_pages, s.duration_ms, s.indexable_pages, s.duplicate_pages
    ));
    out.push_str(&format!(
        "  {} errors · {} warnings · {} notices\n",
        s.errors, s.warnings, s.notices
    ));
    if r.robots_found || r.sitemap_urls > 0 {
        out.push_str(&format!(
            "  robots.txt: {} · sitemap URLs: {}\n",
            if r.robots_found { "found" } else { "none" },
            r.sitemap_urls
        ));
    }
    out.push('\n');

    if !s.by_status.is_empty() {
        out.push_str("  Status codes\n");
        for (code, n) in &s.by_status {
            out.push_str(&format!("    {code:<6} {n}\n"));
        }
        out.push('\n');
    }

    let issues = filtered(r, min);
    let mut by_rule: BTreeMap<&str, (Severity, &str, usize)> = BTreeMap::new();
    for i in &issues {
        let e = by_rule.entry(&i.rule).or_insert((i.severity, &i.title, 0));
        e.2 += 1;
    }
    let mut rows: Vec<_> = by_rule.into_iter().collect();
    rows.sort_by(|a, b| rank(b.1 .0).cmp(&rank(a.1 .0)).then(b.1 .2.cmp(&a.1 .2)));
    if rows.is_empty() {
        out.push_str("  No issues found 🎉\n");
    } else {
        out.push_str("  Issues\n");
        for (_, (sev, title, count)) in rows {
            out.push_str(&format!(
                "    [{}] {:<30} {}\n",
                sev.label().chars().next().unwrap(),
                title,
                count
            ));
        }
        out.push_str("\n  Run `crawlie explain <rule>` to learn why any issue matters.\n");
    }
    out.push('\n');
    out
}

fn explain(rule: Option<String>) -> ExitCode {
    match rule {
        None => {
            println!("\n  crawlie knowledge base — {} rules\n", all_rules().len());
            let mut rules = all_rules();
            rules.sort_by(|a, b| a.category.label().cmp(b.category.label()));
            let mut cat = "";
            for info in &rules {
                if info.category.label() != cat {
                    cat = info.category.label();
                    println!("  {cat}");
                }
                println!(
                    "    {:<26} [{}] {}",
                    info.rule,
                    info.severity.label().chars().next().unwrap(),
                    info.title
                );
            }
            println!("\n  Run `crawlie explain <rule>` for the full guidance.\n");
            ExitCode::SUCCESS
        }
        Some(rule) => match rule_info(&rule) {
            Some(i) => {
                println!(
                    "\n  {}  [{}]  ·  {}\n",
                    i.title,
                    i.severity.label(),
                    i.category.label()
                );
                println!("  WHY IT MATTERS\n  {}\n", wrap(&i.why));
                println!("  HOW TO FIX\n  {}\n", wrap(&i.how_to_fix));
                println!("  IF IGNORED\n  {}\n", wrap(&i.impact));
                ExitCode::SUCCESS
            }
            None => {
                eprintln!(
                    "crawlie: unknown rule '{rule}'. Run `crawlie explain` to list all rules."
                );
                ExitCode::from(2)
            }
        },
    }
}

fn list_reports() -> ExitCode {
    let reports = ReportStore::new(reports_dir()).list();
    if reports.is_empty() {
        println!("\n  No saved reports yet. Run `crawlie crawl <url> --save`.\n");
        return ExitCode::SUCCESS;
    }
    println!("\n  Saved reports\n");
    println!(
        "  {:<20} {:>6} {:>7} {:>5}  {:<34} URL",
        "DATE", "PAGES", "HEALTH", "GEO", "ID"
    );
    for m in reports {
        println!(
            "  {:<20} {:>6} {:>6}/100 {:>3}/100  {:<34} {}",
            crawlie_core::timefmt::format_utc(m.created_at),
            m.total_pages,
            m.health_score,
            m.geo_score,
            m.id,
            m.url
        );
    }
    println!(
        "\n  Print one with `crawlie report <id>` · delete with `crawlie report <id> --delete`.\n"
    );
    ExitCode::SUCCESS
}

fn show_report(a: ReportArgs) -> ExitCode {
    let store = ReportStore::new(reports_dir());
    if a.delete {
        return match store.delete(&a.id) {
            Ok(()) => {
                println!("  deleted report {}", a.id);
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("crawlie: could not delete '{}': {e}", a.id);
                ExitCode::from(2)
            }
        };
    }
    match store.load(&a.id) {
        Some(result) => {
            let rendered = render(&result, a.format, None);
            emit(rendered, a.output, false)
                .err()
                .unwrap_or(ExitCode::SUCCESS)
        }
        None => {
            eprintln!("crawlie: report '{}' not found.", a.id);
            ExitCode::from(2)
        }
    }
}

fn csv(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

fn wrap(s: &str) -> String {
    // simple 76-col wrap with 2-space hanging indent
    let mut out = String::new();
    let mut len = 0;
    for word in s.split_whitespace() {
        if len + word.len() + 1 > 76 {
            out.push_str("\n  ");
            len = 0;
        } else if len > 0 {
            out.push(' ');
            len += 1;
        }
        out.push_str(word);
        len += word.len();
    }
    out
}
