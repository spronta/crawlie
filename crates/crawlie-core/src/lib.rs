//! crawlie-core — the embeddable SEO + GEO crawler engine.
//!
//! A single async crawl pass collects per-page SEO and Generative-Engine signals,
//! then a set of audit rules turns that data into actionable, *explained* issues.
//! The engine has zero host dependencies (no Tauri, no CLI, no globals) so it
//! embeds equally well in the desktop app, the CLI, the MCP server, or a cloud
//! worker.
//!
//! ```no_run
//! # async fn run() {
//! use crawlie_core::{crawl, CrawlConfig, CancelToken};
//! let cfg = CrawlConfig::new("https://example.com");
//! let result = crawl(cfg, |_evt| {}, CancelToken::new()).await.unwrap();
//! println!("{} pages, {} issues", result.pages.len(), result.issues.len());
//! # }
//! ```

pub mod audit;
pub mod crawler;
pub mod fetch;
pub mod knowledge;
pub mod pagestore;
pub mod parse;
pub mod priority;
pub mod report;
pub mod report_html;
pub mod robots;
pub mod scoring;
pub mod sitemap;
pub mod structured_data;
pub mod timefmt;
pub mod types;

pub use crawler::{crawl, crawl_to_store, CancelToken};
pub use knowledge::{all_rules, rule_info};
pub use pagestore::PageStore;
pub use priority::{group_issues, top_fixes, top_fixes_filtered};
pub use report::ReportStore;
pub use scoring::geo_gaps;
pub use types::{
    Category, CrawlConfig, CrawlDiff, CrawlError, CrawlEvent, CrawlMode, CrawlResult, Fix, GeoGaps,
    GeoSignals, Hreflang, Issue, IssueDelta, IssueGroup, Page, Redirect, ReportMeta, RuleInfo,
    SchemaValidation, Severity, Summary,
};
