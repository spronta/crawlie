//! `crawlie` — command-line SEO + GEO crawler.
//!
//! Designed for humans *and* agents. Default output is the full crawl result as
//! JSON on stdout (progress on stderr), so stdout stays a clean machine stream.
//! `--format pretty` for a human report, `--format html` for a shareable file.

use clap::{Parser, Subcommand, ValueEnum};
use crawlie_core::{
    all_rules, crawl, crawl_to_store, report_html, rule_info, top_fixes, CancelToken, CrawlConfig,
    CrawlMode, CrawlResult, Extractor, PageStore, ReportStore, Severity, UrlFilter,
};
mod update;

use crawlie_rules::{Ledger, Resolver, SLOP_DEFAULT_SRC};
use std::io::{Read, Write};
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
    /// Run a deterministic content rule pack (slop / brand) over a site or text.
    Slop(SlopArgs),
    /// Scaffold a repo-level `.crawlie/` directory with a starter slop pack.
    Init,
    /// Manage installed `.crawlie` rule packs (list / add / new / which / remove).
    Pack(PackArgs),
    /// Check for a newer crawlie release and install it.
    Update(UpdateArgs),
    /// Explain why a rule matters and how to fix it (or list all rules).
    Explain { rule: Option<String> },
    /// List saved reports.
    Reports,
    /// Print or export a saved report by id.
    Report(ReportArgs),
    /// Compare two saved reports — what improved, regressed, and changed.
    Diff(DiffArgs),
    /// Inspect a streamed crawl database (created with `crawl --store <path>`).
    Store(StoreArgs),
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
    /// Don't follow the seed's redirect to its canonical host (apex→www,
    /// http→https). Audit the literal start host instead.
    #[arg(long)]
    no_resolve_host: bool,
    /// Only crawl URLs matching this glob (repeatable).
    #[arg(long)]
    include: Vec<String>,
    /// Skip URLs matching this glob (repeatable).
    #[arg(long)]
    exclude: Vec<String>,
    /// Exclude discovered URLs whose host contains this string (repeatable).
    #[arg(long = "exclude-host", value_name = "STR")]
    exclude_host: Vec<String>,
    /// Exclude discovered URLs whose host matches this regex (repeatable).
    #[arg(long = "exclude-host-regex", value_name = "RE")]
    exclude_host_regex: Vec<String>,
    /// Exclude discovered URLs whose path contains this string (repeatable).
    #[arg(long = "exclude-path", value_name = "STR")]
    exclude_path: Vec<String>,
    /// Exclude discovered URLs whose path matches this regex (repeatable).
    #[arg(long = "exclude-path-regex", value_name = "RE")]
    exclude_path_regex: Vec<String>,
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
    /// Custom extraction: `NAME=CSS_SELECTOR` (append `@attr` to read an
    /// attribute instead of text), e.g. `--extract 'price=.product-price'` or
    /// `--extract 'author=meta[name=author]@content'`. Repeatable.
    #[arg(long, value_name = "NAME=SELECTOR")]
    extract: Vec<String>,
    /// Custom extraction via regex over the raw HTML: `NAME=PATTERN` (capture
    /// group 1 if present, else the whole match), e.g. `--extract-regex
    /// 'sku=SKU-(\d+)'`. Repeatable.
    #[arg(long, value_name = "NAME=PATTERN")]
    extract_regex: Vec<String>,
    /// Render each page with headless Chrome before auditing, so JavaScript-
    /// injected content, links and meta tags are seen (for React/Next/Vue and
    /// other client-rendered sites). Requires a Chrome/Chromium/Edge install.
    #[arg(long)]
    render: bool,
    /// Extra settle delay in milliseconds after navigation for late hydration.
    /// Only used with --render.
    #[arg(long, default_value_t = 0, value_name = "MS")]
    render_wait: u64,
    /// Stream pages to an on-disk SQLite store instead of holding them in
    /// memory — for crawling very large sites without running out of RAM. The
    /// crawl is written to this path and becomes the queryable artifact.
    #[arg(long, value_name = "PATH")]
    store: Option<String>,
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
struct UpdateArgs {
    /// Only check for a newer version; don't install.
    #[arg(long)]
    check: bool,
    /// Skip the confirmation prompt.
    #[arg(long, short = 'y')]
    yes: bool,
}

#[derive(Parser)]
struct PackArgs {
    #[command(subcommand)]
    cmd: PackCmd,
}

#[derive(Subcommand)]
enum PackCmd {
    /// List every pack visible here and where each resolves from.
    List,
    /// Install a `.crawlie` file into the repo (default) or globally.
    Add {
        /// Path to the .crawlie file to install.
        path: String,
        /// Install into `~/.crawlie/packs` instead of the repo.
        #[arg(long)]
        global: bool,
        /// Override the installed pack name (defaults to the file stem).
        #[arg(long)]
        name: Option<String>,
    },
    /// Scaffold a new empty pack to edit.
    New {
        name: String,
        #[arg(long)]
        global: bool,
    },
    /// Show which file a pack name resolves to.
    Which { name: String },
    /// Remove an installed pack (repo by default, or --global).
    Remove {
        name: String,
        #[arg(long)]
        global: bool,
    },
}

#[derive(Parser)]
struct SlopArgs {
    /// URL to crawl and score. Omit when using --file or --stdin.
    url: Option<String>,
    /// Score a local text file instead of crawling.
    #[arg(long)]
    file: Option<String>,
    /// Score text read from stdin instead of crawling.
    #[arg(long)]
    stdin: bool,
    /// Rule pack (.crawlie file). Defaults to the built-in slop pack.
    #[arg(long)]
    pack: Option<String>,
    /// Max pages to crawl (URL mode).
    #[arg(long, default_value_t = 100)]
    max_pages: usize,
    /// Output format.
    #[arg(long, value_enum, default_value_t = Format::Pretty)]
    format: Format,
    /// Exit non-zero if any page/text scores at or above this threshold (CI gate).
    #[arg(long)]
    fail_on_score: Option<f64>,
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

#[derive(Parser)]
struct StoreArgs {
    /// Path to the streamed crawl database (the `.db` from `crawl --store`).
    db: String,
    #[arg(long, value_enum, default_value_t = Format::Pretty)]
    format: Format,
    /// Only show findings at or above this severity.
    #[arg(long, value_enum)]
    severity: Option<Sev>,
    /// Write output to a file instead of stdout.
    #[arg(long, short = 'o')]
    output: Option<String>,
}

#[derive(Parser)]
struct DiffArgs {
    /// The earlier report id (see `crawlie reports`).
    old: String,
    /// The later report id to compare against.
    new: String,
    #[arg(long, value_enum, default_value_t = Format::Pretty)]
    format: Format,
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
    // `crawlie update` is the explicit flow; it doesn't also get a passive nudge.
    if let Command::Update(a) = &cli.command {
        return ExitCode::from(update::run_update(a.check, a.yes).await);
    }
    let code = match cli.command {
        Command::Crawl(a) => run_crawl(a).await,
        Command::Audit(a) => run_audit(a).await,
        Command::Slop(a) => run_slop(a).await,
        Command::Init => run_init(),
        Command::Pack(a) => run_pack(a),
        Command::Explain { rule } => explain(rule),
        Command::Reports => list_reports(),
        Command::Report(a) => show_report(a),
        Command::Diff(a) => diff_reports(a),
        Command::Store(a) => show_store(a),
        Command::Update(_) => unreachable!("handled above"),
    };
    // Best-effort, interactive-human-only nudge. Never touches stdout.
    update::maybe_notify().await;
    code
}

async fn run_crawl(a: CrawlArgs) -> ExitCode {
    let mut extract = Vec::new();
    for spec in &a.extract {
        match parse_extractor(spec, false) {
            Ok(e) => extract.push(e),
            Err(m) => {
                eprintln!("crawlie: {m}");
                return ExitCode::from(2);
            }
        }
    }
    for spec in &a.extract_regex {
        match parse_extractor(spec, true) {
            Ok(e) => extract.push(e),
            Err(m) => {
                eprintln!("crawlie: {m}");
                return ExitCode::from(2);
            }
        }
    }
    let filters = |subs: Vec<String>, res: Vec<String>| -> Vec<UrlFilter> {
        subs.into_iter()
            .map(|value| UrlFilter {
                value,
                regex: false,
            })
            .chain(
                res.into_iter()
                    .map(|value| UrlFilter { value, regex: true }),
            )
            .collect()
    };
    let config = CrawlConfig {
        mode: CrawlMode::Site,
        max_pages: a.max_pages,
        max_depth: a.max_depth,
        concurrency: a.concurrency,
        timeout_secs: a.timeout,
        check_external: !a.no_external,
        respect_robots: !a.no_robots,
        use_sitemap: !a.no_sitemap,
        resolve_host: !a.no_resolve_host,
        include: a.include,
        exclude: a.exclude,
        exclude_hosts: filters(a.exclude_host, a.exclude_host_regex),
        exclude_paths: filters(a.exclude_path, a.exclude_path_regex),
        extract,
        render: a.render,
        render_wait_ms: a.render_wait,
        ..CrawlConfig::new(&a.url)
    };
    let min = a.severity.map(sev_rank);
    execute(
        config, a.format, min, a.output, a.save, a.store, a.fail_on, a.quiet,
    )
    .await
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
        None,
        FailOn::None,
        a.quiet,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
/// `~/.crawlie`.
fn crawlie_home() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie")
}

/// `~/.crawlie/packs` — where globally-installed packs live.
fn global_packs_dir() -> PathBuf {
    crawlie_home().join("packs")
}

/// Walk up from the cwd looking for a `.crawlie/` directory (the repo packs).
fn find_repo_crawlie_dir() -> Option<PathBuf> {
    let mut cur = std::env::current_dir().ok()?;
    loop {
        let cand = cur.join(".crawlie");
        if cand.is_dir() {
            return Some(cand);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn make_resolver() -> Resolver {
    Resolver {
        repo_dir: find_repo_crawlie_dir(),
        global_dir: Some(global_packs_dir()),
    }
}

/// Resolve the pack named by `--pack` (a name or a path), or `slop-default`
/// (which a repo can shadow with its own `.crawlie/slop-default.crawlie`).
fn load_pack(reference: Option<&str>) -> Result<crawlie_rules::RulePack, String> {
    let resolver = make_resolver();
    let reference = reference.unwrap_or("slop-default");
    resolver
        .resolve(reference)
        .map(|r| r.pack)
        .map_err(|e| e.to_string())
}

fn run_init() -> ExitCode {
    let dir = PathBuf::from(".crawlie");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("crawlie: {e}");
        return ExitCode::from(2);
    }
    let dest = dir.join("slop-default.crawlie");
    if dest.exists() {
        eprintln!(
            "crawlie: {} already exists — leaving it untouched",
            dest.display()
        );
    } else if let Err(e) = std::fs::write(&dest, SLOP_DEFAULT_SRC) {
        eprintln!("crawlie: {e}");
        return ExitCode::from(2);
    } else {
        eprintln!("  created {}", dest.display());
    }
    eprintln!(
        "\nrepo packs live in .crawlie/ and override the built-ins. Edit them, commit them,\n\
         and run:  crawlie slop <url>            (uses .crawlie/slop-default.crawlie)\n\
         in CI:    crawlie slop <url> --fail-on-score 8"
    );
    ExitCode::SUCCESS
}

fn run_pack(a: PackArgs) -> ExitCode {
    match a.cmd {
        PackCmd::List => {
            let resolver = make_resolver();
            let entries = resolver.available();
            if entries.is_empty() {
                println!("no packs found");
            }
            for e in entries {
                println!("  {:<20} {}", e.name, e.origin.label());
            }
            ExitCode::SUCCESS
        }
        PackCmd::Which { name } => match make_resolver().resolve(&name) {
            Ok(r) => {
                println!("{}", r.origin.label());
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("crawlie: {e}");
                ExitCode::from(1)
            }
        },
        PackCmd::Add { path, global, name } => {
            let src = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("crawlie: {path}: {e}");
                    return ExitCode::from(2);
                }
            };
            let stem = name.unwrap_or_else(|| {
                std::path::Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("pack")
                    .to_string()
            });
            // Validate before installing — never install a broken pack.
            if let Err(e) = crawlie_rules::load(&stem, &src) {
                eprintln!("crawlie: {path}:{e}");
                return ExitCode::from(2);
            }
            let dir = if global {
                global_packs_dir()
            } else {
                find_repo_crawlie_dir().unwrap_or_else(|| PathBuf::from(".crawlie"))
            };
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("crawlie: {e}");
                return ExitCode::from(2);
            }
            let dest = dir.join(format!("{stem}.crawlie"));
            if let Err(e) = std::fs::write(&dest, src) {
                eprintln!("crawlie: {e}");
                return ExitCode::from(2);
            }
            eprintln!("  installed `{stem}` → {}", dest.display());
            ExitCode::SUCCESS
        }
        PackCmd::New { name, global } => {
            let dir = if global {
                global_packs_dir()
            } else {
                find_repo_crawlie_dir().unwrap_or_else(|| PathBuf::from(".crawlie"))
            };
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("crawlie: {e}");
                return ExitCode::from(2);
            }
            let dest = dir.join(format!("{name}.crawlie"));
            if dest.exists() {
                eprintln!("crawlie: {} already exists", dest.display());
                return ExitCode::from(1);
            }
            let template = format!(
                "# {name}.crawlie — edit these rules to match your voice.\n\n\
                 phrase_rule(\"banned-terms\", weight = 5, phrases = [\n\
                 \x20   \"disrupt\", \"revolutionary\", \"synergy\",\n\
                 ])\n\n\
                 metric_rule(\"too-uniform\", weight = 3,\n\
                 \x20   metric = sentence_variance(), when = below(12))\n"
            );
            if let Err(e) = std::fs::write(&dest, template) {
                eprintln!("crawlie: {e}");
                return ExitCode::from(2);
            }
            eprintln!("  created {}", dest.display());
            ExitCode::SUCCESS
        }
        PackCmd::Remove { name, global } => {
            let dir = if global {
                global_packs_dir()
            } else {
                match find_repo_crawlie_dir() {
                    Some(d) => d,
                    None => {
                        eprintln!("crawlie: no repo .crawlie/ directory found");
                        return ExitCode::from(1);
                    }
                }
            };
            let target = dir.join(format!("{name}.crawlie"));
            match std::fs::remove_file(&target) {
                Ok(_) => {
                    eprintln!("  removed {}", target.display());
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("crawlie: {}: {e}", target.display());
                    ExitCode::from(1)
                }
            }
        }
    }
}

fn print_ledger_pretty(label: &str, ledger: &Ledger) {
    println!("\n{label}  ·  slop score {:.1}", ledger.score);
    if ledger.hits.is_empty() {
        println!("  clean — no rules fired");
        return;
    }
    for hit in &ledger.hits {
        println!("  +{:<4.1} {}", hit.points, hit.rule);
        for ev in &hit.evidence {
            println!("        {ev}");
        }
    }
}

async fn run_slop(a: SlopArgs) -> ExitCode {
    let pack = match load_pack(a.pack.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("crawlie: {e}");
            return ExitCode::from(2);
        }
    };

    // ---- text modes: --file / --stdin ----
    if a.stdin || a.file.is_some() {
        let text = if a.stdin {
            let mut s = String::new();
            if std::io::stdin().read_to_string(&mut s).is_err() {
                eprintln!("crawlie: could not read stdin");
                return ExitCode::from(2);
            }
            s
        } else {
            match std::fs::read_to_string(a.file.as_deref().unwrap()) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("crawlie: {e}");
                    return ExitCode::from(2);
                }
            }
        };
        let ledger = pack.evaluate(&text);
        match a.format {
            Format::Json => println!("{}", serde_json::to_string_pretty(&ledger).unwrap()),
            _ => print_ledger_pretty("(input)", &ledger),
        }
        return slop_exit(&[ledger.score], a.fail_on_score);
    }

    // ---- URL mode: crawl, then score each page's text ----
    let Some(url) = a.url.clone() else {
        eprintln!("crawlie: provide a URL, or use --file / --stdin");
        return ExitCode::from(2);
    };
    let config = CrawlConfig {
        mode: CrawlMode::Site,
        max_pages: a.max_pages,
        ..CrawlConfig::new(&url)
    };
    let quiet = a.quiet;
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
        eprintln!("\r\x1b[2K  done · {} pages", result.summary.total_pages);
    }

    // Evaluate every page that has body text, score-descending.
    let mut scored: Vec<(String, Ledger)> = result
        .pages
        .iter()
        .filter_map(|p| p.text.as_ref().map(|t| (p.url.clone(), pack.evaluate(t))))
        .collect();
    scored.sort_by(|a, b| {
        b.1.score
            .partial_cmp(&a.1.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let scores: Vec<f64> = scored.iter().map(|(_, l)| l.score).collect();

    match a.format {
        Format::Json => {
            let arr: Vec<_> = scored
                .iter()
                .map(|(u, l)| serde_json::json!({"url": u, "score": l.score, "hits": l.hits}))
                .collect();
            println!("{}", serde_json::to_string_pretty(&arr).unwrap());
        }
        _ => {
            let avg = if scores.is_empty() {
                0.0
            } else {
                scores.iter().sum::<f64>() / scores.len() as f64
            };
            println!(
                "\nslop report · pack `{}` · {} pages · avg {:.1} · worst {:.1}",
                scored
                    .first()
                    .map(|(_, l)| l.pack.as_str())
                    .unwrap_or("slop-default"),
                scored.len(),
                avg,
                scores.first().copied().unwrap_or(0.0),
            );
            for (u, l) in scored.iter().take(20) {
                let rules: Vec<&str> = l.hits.iter().map(|h| h.rule.as_str()).collect();
                println!("  {:>5.1}  {}", l.score, truncate(u, 64));
                if !rules.is_empty() {
                    println!("         {}", rules.join(", "));
                }
            }
        }
    }
    slop_exit(&scores, a.fail_on_score)
}

/// Apply the `--fail-on-score` CI gate.
fn slop_exit(scores: &[f64], threshold: Option<f64>) -> ExitCode {
    match threshold {
        Some(t) if scores.iter().any(|&s| s >= t) => ExitCode::from(1),
        _ => ExitCode::SUCCESS,
    }
}

#[allow(clippy::too_many_arguments)]
async fn execute(
    config: CrawlConfig,
    format: Format,
    min: Option<u8>,
    output: Option<String>,
    save: bool,
    store: Option<String>,
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

    // Streaming (out-of-core) mode spills pages to an on-disk store; the default
    // mode keeps them in memory.
    let result = if let Some(path) = store.as_deref() {
        match crawl_to_store(config, path, on_event, CancelToken::new()).await {
            Ok((r, _store)) => {
                if !quiet {
                    eprintln!(
                        "\r\x1b[2K  streamed {} pages → {path}",
                        r.summary.total_pages
                    );
                }
                r
            }
            Err(e) => {
                eprintln!("\rcrawlie: {e}");
                return ExitCode::from(2);
            }
        }
    } else {
        match crawl(config, on_event, CancelToken::new()).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("\rcrawlie: {e}");
                return ExitCode::from(2);
            }
        }
    };
    if !quiet {
        eprintln!(
            "\r\x1b[2K  done · {} pages · health {}/100 · GEO {}/100 · a11y {}/100 · {} ms",
            result.summary.total_pages,
            result.summary.health_score,
            result.summary.geo_score,
            result.summary.a11y_score,
            result.summary.duration_ms
        );
        if !result.config.extract.is_empty() {
            let names: Vec<&str> = result
                .config
                .extract
                .iter()
                .map(|e| e.name.as_str())
                .collect();
            let hit = result
                .pages
                .iter()
                .filter(|p| !p.extractions.is_empty())
                .count();
            eprintln!(
                "  extracted {} ({}) from {} pages · --format csv for the table",
                names.len(),
                names.join(", "),
                hit
            );
        }
    }

    if save {
        if store.is_some() {
            // In streaming mode the pages live in the --store database, not in
            // the in-memory result, so saving to history would store an empty
            // report. The .db is the artifact — inspect it with `crawlie store`.
            if !quiet {
                eprintln!("  note: --save ignored in --store mode; the crawl is in the database. Inspect it with `crawlie store <path>`.");
            }
        } else {
            match ReportStore::new(reports_dir()).save(&result) {
                Ok(meta) => {
                    if !quiet {
                        eprintln!("  saved report {}", meta.id)
                    }
                }
                Err(e) => eprintln!("  warning: could not save report: {e}"),
            }
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
        // With extractors, CSV is the extraction table (url + a column per
        // extractor); otherwise it's the issue list.
        Format::Csv if !r.config.extract.is_empty() => render_extract_csv(r),
        Format::Csv => render_csv(r, min),
        Format::Html => report_html::render(r),
    }
}

/// One row per crawled page: `url` plus a column for each extractor (multiple
/// matches joined by ` | `).
fn render_extract_csv(r: &CrawlResult) -> String {
    let names: Vec<&str> = r.config.extract.iter().map(|e| e.name.as_str()).collect();
    let mut out = String::from("url");
    for n in &names {
        out.push(',');
        out.push_str(&csv(n));
    }
    out.push('\n');
    for p in r.pages.iter().filter(|p| p.status == 200) {
        out.push_str(&csv(&p.url));
        for n in &names {
            let v = p
                .extractions
                .iter()
                .find(|e| &e.name == n)
                .map(|e| e.values.join(" | "))
                .unwrap_or_default();
            out.push(',');
            out.push_str(&csv(&v));
        }
        out.push('\n');
    }
    out
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
        "robotsFound": r.robots_found, "sitemapUrls": r.sitemap_urls, "sitemapFound": r.sitemap_found, "startedAt": r.started_at,
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
        "  Health {}/100   GEO {}/100   A11y {}/100\n",
        s.health_score, s.geo_score, s.a11y_score
    ));
    out.push_str(&format!(
        "  {} pages · {} ms · {} indexable · {} duplicate\n",
        s.total_pages, s.duration_ms, s.indexable_pages, s.duplicate_pages
    ));
    out.push_str(&format!(
        "  {} errors · {} warnings · {} notices\n",
        s.errors, s.warnings, s.notices
    ));
    out.push_str(&format!(
        "  robots.txt: {} · sitemap: {} · llms.txt: {}\n",
        if r.robots_found { "found" } else { "none" },
        if r.sitemap_found {
            if r.sitemap_urls > 0 {
                format!("{} URLs", r.sitemap_urls)
            } else {
                "found".to_string()
            }
        } else {
            "none".to_string()
        },
        if r.llms_txt_found { "found" } else { "none" }
    ));
    if let Some(from) = &r.seed_redirected_from {
        out.push_str(&format!(
            "  ↪ {from} redirects to its canonical host — audited {}\n",
            r.config.url
        ));
    }
    out.push('\n');

    // Prioritized action plan — the highest-impact fixes first.
    let fixes = top_fixes(&r.issues, 5);
    if !fixes.is_empty() {
        out.push_str("  Top fixes\n");
        for (n, f) in fixes.iter().enumerate() {
            out.push_str(&format!("    {}. {} ({})\n", n + 1, f.title, f.count));
            if !f.how_to_fix.is_empty() {
                out.push_str(&format!("       → {}\n", truncate(&f.how_to_fix, 86)));
            }
        }
        out.push('\n');
    }

    if !s.by_status.is_empty() {
        out.push_str("  Status codes\n");
        for (code, n) in &s.by_status {
            out.push_str(&format!("    {code:<6} {n}\n"));
        }
        out.push('\n');
    }

    let g = &r.link_graph;
    if !g.nodes.is_empty() {
        out.push_str("  Link graph\n");
        out.push_str(&format!(
            "    {} nodes · {} edges · {:.1} avg outlinks · max depth {}\n",
            g.nodes.len(),
            g.edges.len(),
            g.avg_outlinks,
            g.max_depth
        ));
        out.push_str(&format!(
            "    {} orphans · {} dead ends · {} reciprocal pairs\n",
            g.orphans, g.dead_ends, g.reciprocal_pairs
        ));
        let auth: Vec<_> = g
            .top_authorities
            .iter()
            .filter_map(|&i| g.nodes.get(i as usize))
            .take(3)
            .collect();
        if !auth.is_empty() {
            out.push_str("    Top authority\n");
            for node in auth {
                out.push_str(&format!(
                    "      {:>3.0}  {}\n",
                    node.link_score,
                    truncate(&node.url, 58)
                ));
            }
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
        "  {:<20} {:>6} {:>7} {:>5} {:>5}  {:<34} URL",
        "DATE", "PAGES", "HEALTH", "GEO", "A11Y", "ID"
    );
    for m in reports {
        println!(
            "  {:<20} {:>6} {:>6}/100 {:>3}/100 {:>3}/100  {:<34} {}",
            crawlie_core::timefmt::format_utc(m.created_at),
            m.total_pages,
            m.health_score,
            m.geo_score,
            m.a11y_score,
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

fn show_store(a: StoreArgs) -> ExitCode {
    let store = match PageStore::open(&a.db) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("crawlie: can't open '{}': {e}", a.db);
            return ExitCode::from(2);
        }
    };
    // Pretty/CSV render from issues + summary only; JSON/HTML need the pages.
    let need_pages = matches!(a.format, Format::Json | Format::Html);
    let result = match store.to_result(need_pages) {
        Ok(Some(r)) => r,
        Ok(None) => {
            eprintln!(
                "crawlie: '{}' isn't a finalized crawl store (no metadata). Was the crawl interrupted?",
                a.db
            );
            return ExitCode::from(2);
        }
        Err(e) => {
            eprintln!("crawlie: {e}");
            return ExitCode::from(2);
        }
    };
    let min = a.severity.map(sev_rank);
    let rendered = render(&result, a.format, min);
    emit(rendered, a.output, false)
        .err()
        .unwrap_or(ExitCode::SUCCESS)
}

fn diff_reports(a: DiffArgs) -> ExitCode {
    let store = ReportStore::new(reports_dir());
    let diff = match store.diff(&a.old, &a.new) {
        Ok(Some(d)) => d,
        Ok(None) => {
            eprintln!(
                "crawlie: one or both reports not found ('{}', '{}'). Run `crawlie reports`.",
                a.old, a.new
            );
            return ExitCode::from(2);
        }
        Err(e) => {
            eprintln!("crawlie: {e}");
            return ExitCode::from(2);
        }
    };
    match a.format {
        Format::Json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&diff).unwrap_or_default()
            );
        }
        _ => print_diff_pretty(&diff),
    }
    ExitCode::SUCCESS
}

fn signed(n: i16) -> String {
    if n > 0 {
        format!("+{n}")
    } else {
        n.to_string()
    }
}

fn print_diff_pretty(d: &crawlie_core::CrawlDiff) {
    println!("\n  crawlie diff");
    println!("  {}", "─".repeat(54));
    println!(
        "  {}  →  {}",
        crawlie_core::timefmt::format_utc(d.old_created_at),
        crawlie_core::timefmt::format_utc(d.new_created_at)
    );
    println!(
        "  Health {} → {} ({})    GEO {} → {} ({})    A11y {} → {} ({})",
        d.health_before,
        d.health_after,
        signed(d.health_delta),
        d.geo_before,
        d.geo_after,
        signed(d.geo_delta),
        d.a11y_before,
        d.a11y_after,
        signed(d.a11y_delta),
    );
    println!(
        "  Pages {} → {}   (+{} new, -{} gone)",
        d.pages_before,
        d.pages_after,
        d.pages_added.len(),
        d.pages_removed.len(),
    );

    let total = |v: &[crawlie_core::IssueDelta]| v.iter().map(|d| d.count).sum::<usize>();
    println!(
        "\n  Resolved: {} issues across {} rules",
        total(&d.resolved_issues),
        d.resolved_issues.len()
    );
    for delta in d.resolved_issues.iter().take(10) {
        println!("    ✓ {:<30} {}", delta.title, delta.count);
    }
    println!(
        "\n  New: {} issues across {} rules",
        total(&d.new_issues),
        d.new_issues.len()
    );
    for delta in d.new_issues.iter().take(10) {
        println!(
            "    [{}] {:<28} {}",
            delta.severity.label().chars().next().unwrap(),
            delta.title,
            delta.count
        );
    }

    if !d.pages_added.is_empty() {
        println!("\n  New pages");
        for u in d.pages_added.iter().take(10) {
            println!("    + {}", truncate(u, 70));
        }
        if d.pages_added.len() > 10 {
            println!("    … and {} more", d.pages_added.len() - 10);
        }
    }
    println!();
}

/// Parse a `NAME=SELECTOR` (or `NAME=PATTERN` for regex) extractor spec. For CSS,
/// a trailing `@attr` reads that attribute instead of the element text. Splits on
/// the first `=`, so selectors/patterns may contain `=` freely.
fn parse_extractor(spec: &str, is_regex: bool) -> Result<Extractor, String> {
    let (name, rest) = spec.split_once('=').ok_or_else(|| {
        format!("extractor '{spec}' must be NAME=VALUE — e.g. price=.product-price")
    })?;
    let name = name.trim();
    let rest = rest.trim();
    if name.is_empty() || rest.is_empty() {
        return Err(format!("extractor '{spec}' needs both a name and a value"));
    }
    if is_regex {
        Ok(Extractor {
            name: name.to_string(),
            css: None,
            attr: None,
            regex: Some(rest.to_string()),
        })
    } else {
        let (sel, attr) = split_attr(rest);
        Ok(Extractor {
            name: name.to_string(),
            css: Some(sel.trim().to_string()),
            attr,
            regex: None,
        })
    }
}

/// Peel a trailing `@attr` off a CSS selector. Only treats it as an attribute
/// when `attr` looks like an attribute name, so selectors containing `@` in a
/// value (e.g. `a[href*="@"]`) aren't mangled.
fn split_attr(sel: &str) -> (&str, Option<String>) {
    if let Some(idx) = sel.rfind('@') {
        let attr = &sel[idx + 1..];
        if !attr.is_empty()
            && attr
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return (&sel[..idx], Some(attr.to_string()));
        }
    }
    (sel, None)
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
