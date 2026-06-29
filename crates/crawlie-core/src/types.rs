//! Serializable data types shared across every crawlie surface (engine, CLI,
//! MCP, desktop UI). Everything is `serde`-friendly with camelCase JSON so the
//! TypeScript frontend and agent tooling can consume it directly.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn default_max_pages() -> usize {
    500
}
fn default_max_depth() -> usize {
    16
}
fn default_concurrency() -> usize {
    16
}
fn default_timeout() -> u64 {
    15
}
fn default_user_agent() -> String {
    "crawlie (+https://crawlie.dev)".to_string()
}
fn default_true() -> bool {
    true
}
fn default_render_wait() -> u64 {
    0
}

/// What to crawl.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CrawlMode {
    /// Follow links from the seed across the whole site (default).
    #[default]
    Site,
    /// Audit a single URL, no link following.
    Page,
    /// Audit an explicit list of URLs, no link following.
    List,
}

/// Inputs to a crawl.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlConfig {
    /// Seed URL (Site/Page mode). For List mode this is informational.
    pub url: String,
    /// Crawl mode.
    #[serde(default)]
    pub mode: CrawlMode,
    /// Explicit URL list for List mode.
    #[serde(default)]
    pub urls: Vec<String>,
    /// Hard cap on number of pages fetched.
    #[serde(default = "default_max_pages")]
    pub max_pages: usize,
    /// Maximum link depth from the seed (seed = depth 0).
    #[serde(default = "default_max_depth")]
    pub max_depth: usize,
    /// Number of in-flight requests.
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    /// Per-request timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// User-Agent header sent with every request.
    #[serde(default = "default_user_agent")]
    pub user_agent: String,
    /// Verify external (and uncrawled internal) link targets with HEAD requests.
    #[serde(default = "default_true")]
    pub check_external: bool,
    /// Respect robots.txt directives for our user-agent.
    #[serde(default = "default_true")]
    pub respect_robots: bool,
    /// Seed the crawl from the site's sitemap.xml in addition to the homepage.
    #[serde(default = "default_true")]
    pub use_sitemap: bool,
    /// Resolve the seed's redirect to its canonical host before crawling (e.g.
    /// apex → www, http → https). Re-bases scope and the robots/sitemap/llms
    /// checks on the destination host. Disable to audit the literal start host.
    #[serde(default = "default_true")]
    pub resolve_host: bool,
    /// Only crawl URLs whose path contains one of these (substring/glob, `*` ok).
    #[serde(default)]
    pub include: Vec<String>,
    /// Skip URLs whose path matches one of these (substring/glob, `*` ok).
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Custom data extractors run against every crawled HTML page.
    #[serde(default)]
    pub extract: Vec<Extractor>,
    /// Exclude discovered URLs whose **host** matches any of these rules. Each
    /// rule is a substring match by default, or a regular expression when
    /// `regex` is set. The seed/explicit URLs are never excluded.
    #[serde(default)]
    pub exclude_hosts: Vec<UrlFilter>,
    /// Exclude discovered URLs whose **path** matches any of these rules
    /// (substring or regex). Applied to the URL path (e.g. `/share.php`).
    #[serde(default)]
    pub exclude_paths: Vec<UrlFilter>,
    /// Render each HTML page with headless Chrome before parsing, so audits see
    /// JavaScript-injected content, links and meta tags. Requires a build with
    /// the `render` feature and a Chrome/Chromium/Edge install on the host.
    #[serde(default)]
    pub render: bool,
    /// Extra settle delay in milliseconds after navigation, for content that
    /// hydrates late. Only used when `render` is on.
    #[serde(default = "default_render_wait")]
    pub render_wait_ms: u64,
}

/// A host/path exclusion rule: a substring match by default, or a regular
/// expression when `regex` is true.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlFilter {
    /// The substring or regex pattern to match.
    pub value: String,
    /// Treat `value` as a regular expression instead of a literal substring.
    #[serde(default)]
    pub regex: bool,
}

/// A user-defined extractor: pull arbitrary data off every page via a CSS
/// selector (optionally an attribute) or a regular expression. The
/// Screaming-Frog-style "custom extraction" feature.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extractor {
    /// Column name for the extracted values, e.g. `price`.
    pub name: String,
    /// CSS selector (mutually exclusive with `regex`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css: Option<String>,
    /// Attribute to read from matched elements; `None` extracts text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attr: Option<String>,
    /// Regular expression run over the raw HTML (mutually exclusive with `css`).
    /// Capture group 1 is used when present, otherwise the whole match.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
}

/// The values one [`Extractor`] pulled from a single page (in document order).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractValue {
    pub name: String,
    pub values: Vec<String>,
}

impl CrawlConfig {
    /// A sensible default config for the given seed URL.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            mode: CrawlMode::Site,
            urls: Vec::new(),
            max_pages: default_max_pages(),
            max_depth: default_max_depth(),
            concurrency: default_concurrency(),
            timeout_secs: default_timeout(),
            user_agent: default_user_agent(),
            check_external: true,
            respect_robots: true,
            use_sitemap: true,
            resolve_host: true,
            include: Vec::new(),
            exclude: Vec::new(),
            exclude_hosts: Vec::new(),
            exclude_paths: Vec::new(),
            extract: Vec::new(),
            render: false,
            render_wait_ms: default_render_wait(),
        }
    }
}

/// A single redirect hop captured while resolving a URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Redirect {
    pub from: String,
    pub to: String,
    pub status: u16,
}

/// An hreflang alternate declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hreflang {
    pub lang: String,
    pub href: String,
}

/// Everything the crawler learned about one URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    // --- request / response ---
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub redirect_chain: Vec<Redirect>,
    pub content_type: Option<String>,
    pub response_time_ms: u64,
    pub size_bytes: usize,
    pub depth: usize,
    pub server: Option<String>,
    pub content_encoding: Option<String>,
    pub cache_control: Option<String>,
    pub x_robots_tag: Option<String>,
    pub hsts: bool,

    // --- on-page SEO ---
    pub title: Option<String>,
    pub meta_description: Option<String>,
    pub h1: Vec<String>,
    pub h2_count: usize,
    pub h3_count: usize,
    pub word_count: usize,
    pub text_ratio: f32,
    /// Normalized visible body text — the input for content/slop/brand rule
    /// packs (`crawlie-rules`). `None` for non-HTML or error responses.
    #[serde(default)]
    pub text: Option<String>,
    pub canonical: Option<String>,
    pub meta_robots: Option<String>,
    pub lang: Option<String>,
    pub has_viewport: bool,

    // --- rendering ---
    /// Whether this page was audited from its headless-Chrome-rendered DOM
    /// (`true`) rather than the raw server HTML. Only set when render mode is on.
    #[serde(default)]
    pub rendered: bool,
    /// Word count of the *raw* server HTML, before JavaScript ran. Compared with
    /// `word_count` (post-render) to detect content that only exists after JS.
    /// Equals `word_count` when render mode is off.
    #[serde(default)]
    pub pre_render_word_count: usize,

    // --- indexability (derived) ---
    pub indexable: bool,
    pub indexability: Option<String>,
    pub canonicalized: bool,

    // --- media ---
    pub images_total: usize,
    pub images_missing_alt: usize,

    // --- links ---
    pub internal_links: Vec<String>,
    pub external_links: Vec<String>,
    pub inlinks: usize,
    /// Internal PageRank authority, 0–100 (the most-linked page = 100).
    #[serde(default)]
    pub link_score: f32,
    /// Per-page SEO score, 0–100 (Yoast-style): 100 minus this page's own
    /// technical-SEO issues. 0 for non-200 pages.
    #[serde(default)]
    pub seo_score: u8,

    // --- social / structured data ---
    pub og_title: Option<String>,
    pub og_image: Option<String>,
    pub twitter_card: Option<String>,
    pub schema_types: Vec<String>,
    /// Per-schema-item validation: required/recommended properties Google needs
    /// for rich results that are missing from the page's JSON-LD.
    #[serde(default)]
    pub schema_validations: Vec<SchemaValidation>,
    /// Number of JSON-LD `<script>` blocks that failed to parse as JSON.
    #[serde(default)]
    pub invalid_jsonld: usize,
    pub hreflang: Vec<Hreflang>,

    // --- security ---
    pub mixed_content: usize,

    // --- accessibility (WCAG) signals ---
    /// Static accessibility signals (missing labels, unnamed controls, zoom
    /// blocking, heading-order breaks). `#[serde(default)]` so reports saved
    /// before the a11y pillar load with an all-zero default.
    #[serde(default)]
    pub a11y: A11ySignals,

    // --- GEO (Generative Engine Optimization) signals ---
    pub geo: GeoSignals,

    // --- custom extraction ---
    /// Values pulled by the configured [`Extractor`]s. Empty unless extractors
    /// were set and matched.
    #[serde(default)]
    pub extractions: Vec<ExtractValue>,

    // --- dedup ---
    pub content_hash: Option<String>,
    pub duplicate_of: Option<String>,

    // --- error ---
    pub error: Option<String>,
}

/// Signals that determine how well a page can be cited by AI / generative search
/// engines (ChatGPT, Perplexity, Google AI Overviews, etc).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoSignals {
    /// Uses semantic landmarks (`<main>`, `<article>`, `<section>`).
    pub semantic_html: bool,
    /// Has any JSON-LD structured data.
    pub structured_data: bool,
    /// Declares an author (schema author / meta / rel=author).
    pub has_author: bool,
    /// Declares a published/modified date.
    pub has_date: bool,
    /// Has FAQ / QAPage structured data.
    pub faq_schema: bool,
    /// Number of headings phrased as questions (great for answer extraction).
    pub question_headings: usize,
    /// Number of list/table blocks (extractable, citable chunks).
    pub structured_blocks: usize,
    /// Direct answer present near the top (heading immediately followed by prose).
    pub answerable: bool,
    /// 0–100 readiness score for generative engines.
    pub score: u8,
}

/// Static accessibility signals extracted from one page's HTML. Every check here
/// is decidable from markup alone (no rendering or contrast analysis), so it's
/// cheap and false-positive-resistant. Counts are per-page; `*_total` fields give
/// the denominator for "N of M" reporting.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct A11ySignals {
    /// `<a href>` elements with no accessible name (no text, `aria-label`,
    /// `title`, or alt-bearing image inside).
    pub links_no_text: usize,
    /// Total in-page links considered (denominator for `links_no_text`).
    pub links_total: usize,
    /// `<button>` / button-type `<input>` elements with no accessible name.
    pub buttons_no_text: usize,
    /// Total buttons considered (denominator for `buttons_no_text`).
    pub buttons_total: usize,
    /// Form controls (`input`/`select`/`textarea`) with no associated label,
    /// `aria-label`/`aria-labelledby`, `title`, or wrapping `<label>`.
    pub inputs_no_label: usize,
    /// Total labelable form controls considered (denominator for `inputs_no_label`).
    pub controls_total: usize,
    /// `<iframe>` elements with no `title`/`aria-label` (frame has no name).
    pub iframes_no_title: usize,
    /// Elements with a positive `tabindex` (disrupts natural focus order).
    pub positive_tabindex: usize,
    /// A heading level was skipped going down the document (e.g. h2 → h4).
    pub skipped_heading: bool,
    /// The viewport meta blocks pinch-zoom (`user-scalable=no` or
    /// `maximum-scale` below 2), a WCAG 1.4.4 failure.
    pub viewport_blocks_zoom: bool,
    /// 0–100 accessibility score for this page (100 minus weighted penalties for
    /// the failures above). Filled by `scoring::a11y_score`; 0 for non-HTML pages.
    pub score: u8,
}

/// Validation result for one JSON-LD structured-data item (one `@type`),
/// listing the Google rich-result properties it's missing. Empty vectors mean
/// the item is complete for that tier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaValidation {
    /// The schema.org `@type`, e.g. `Product`, `FAQPage`, `Article`.
    pub type_name: String,
    /// Properties Google requires for this type's rich result — omitting these
    /// makes the page ineligible.
    pub missing_required: Vec<String>,
    /// Recommended properties that strengthen the rich result but aren't required.
    pub missing_recommended: Vec<String>,
}

/// Severity of an audit finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Notice,
    /// A positive signal worth highlighting (e.g. strong GEO readiness).
    Good,
}

impl Severity {
    pub fn label(&self) -> &'static str {
        match self {
            Severity::Error => "Error",
            Severity::Warning => "Warning",
            Severity::Notice => "Notice",
            Severity::Good => "Good",
        }
    }
}

/// Audit category an issue belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Response,
    Indexability,
    Links,
    TitlesMeta,
    Headings,
    Content,
    Images,
    Canonical,
    Security,
    Performance,
    Mobile,
    International,
    Social,
    StructuredData,
    Accessibility,
    Geo,
}

impl Category {
    pub fn label(&self) -> &'static str {
        match self {
            Category::Response => "Response Codes",
            Category::Indexability => "Indexability",
            Category::Links => "Links",
            Category::TitlesMeta => "Titles & Meta",
            Category::Headings => "Headings",
            Category::Content => "Content",
            Category::Images => "Images",
            Category::Canonical => "Canonicals",
            Category::Security => "Security",
            Category::Performance => "Performance",
            Category::Mobile => "Mobile",
            Category::International => "International",
            Category::Social => "Social",
            Category::StructuredData => "Structured Data",
            Category::Accessibility => "Accessibility",
            Category::Geo => "Generative Engine Optimization",
        }
    }
}

/// A single audit finding tied to one URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Stable machine id, e.g. `title-missing`.
    pub rule: String,
    /// Human-readable summary, e.g. `Missing Title`.
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    /// The affected URL.
    pub url: String,
    /// Optional extra context (the broken target, lengths, counts, ...).
    pub detail: Option<String>,
}

/// Educational guidance for a rule — *why it matters* and *how to fix it*.
/// This is what makes crawlie teach, not just report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInfo {
    pub rule: String,
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    /// Why this matters for SEO / GEO / users.
    pub why: String,
    /// Concrete steps to fix it.
    pub how_to_fix: String,
    /// Plain-language impact if left unaddressed.
    pub impact: String,
}

/// Roll-up counts and scores for a finished crawl.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub total_pages: usize,
    pub errors: usize,
    pub warnings: usize,
    pub notices: usize,
    pub good: usize,
    /// Overall technical-SEO health score, 0–100.
    pub health_score: u8,
    /// Average GEO readiness across indexable HTML pages, 0–100.
    pub geo_score: u8,
    /// Average accessibility score across HTML pages, 0–100. Reported separately
    /// from health — a11y issues don't drag down the technical-SEO score.
    #[serde(default)]
    pub a11y_score: u8,
    pub avg_response_ms: u64,
    pub indexable_pages: usize,
    pub duplicate_pages: usize,
    /// Status code -> count ("0" = connection error).
    pub by_status: BTreeMap<String, usize>,
    /// Category label -> issue count.
    pub by_category: BTreeMap<String, usize>,
    /// Click depth -> page count.
    pub by_depth: BTreeMap<String, usize>,
    pub duration_ms: u64,
}

/// The complete output of a crawl: every page, every issue, and a summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlResult {
    pub config: CrawlConfig,
    pub pages: Vec<Page>,
    pub issues: Vec<Issue>,
    pub summary: Summary,
    /// robots.txt was found and parsed.
    pub robots_found: bool,
    /// Number of URLs discovered from sitemaps.
    pub sitemap_urls: usize,
    /// An XML sitemap was found (declared in robots.txt or at `/sitemap.xml`).
    #[serde(default)]
    pub sitemap_found: bool,
    /// URLs skipped because robots.txt disallowed them.
    pub robots_blocked: Vec<String>,
    /// Whether the site publishes an `/llms.txt` (AI-engine guidance file).
    #[serde(default)]
    pub llms_txt_found: bool,
    /// The internal-link graph: nodes, edges, and structure analytics. Rebuilt
    /// on report load, so older reports gain it without a re-crawl.
    #[serde(default)]
    pub link_graph: LinkGraph,
    /// When the seed redirected to a different host and the crawl re-based on it
    /// (apex → www, http → https), the original start URL. `None` otherwise.
    #[serde(default)]
    pub seed_redirected_from: Option<String>,
    /// Unix-ms timestamp the crawl started.
    pub started_at: u64,
}

/// The internal-link graph for a crawl: every crawled page as a node, every
/// resolved internal link as a directed edge, plus structure analytics. The
/// raw signals (`inlinks`, `linkScore`, `depth`) live on each [`Page`]; this
/// assembles them into a graph the desktop can draw and agents can query.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraph {
    /// One node per crawled page, in `pages` order (so `nodes[i]` ↔ `pages[i]`).
    pub nodes: Vec<LinkNode>,
    /// Directed internal-link edges as `[fromIndex, toIndex]` into `nodes`.
    pub edges: Vec<[u32; 2]>,
    /// Indexable pages with no internal inlinks (reachable only via sitemap).
    pub orphans: usize,
    /// Indexable pages with no internal outlinks (they pass on no authority).
    pub dead_ends: usize,
    /// Greatest click depth from the seed.
    pub max_depth: usize,
    /// Mean resolved internal outlinks per page.
    pub avg_outlinks: f32,
    /// Count of A→B pairs where B also links back to A.
    pub reciprocal_pairs: usize,
    /// Node indices of the highest-authority pages (by `linkScore`), descending.
    pub top_authorities: Vec<u32>,
    /// Node indices of the biggest hubs (by outlinks), descending.
    pub top_hubs: Vec<u32>,
}

/// One page as a node in the [`LinkGraph`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkNode {
    pub url: String,
    pub depth: usize,
    pub inlinks: usize,
    /// Resolved internal outlinks (edges to other crawled pages).
    pub outlinks: usize,
    /// Internal PageRank authority, 0–100.
    pub link_score: f32,
    pub indexable: bool,
    pub status: u16,
    /// No internal inlinks point here.
    pub orphan: bool,
    /// No internal outlinks leave here.
    pub dead_end: bool,
}

/// Site-wide GEO gap analysis: how many indexable pages lack each AI-readiness
/// signal. Pre-computed so agents don't have to aggregate it themselves.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoGaps {
    /// Indexable HTML pages considered.
    pub pages: usize,
    pub missing_author: usize,
    pub missing_date: usize,
    pub no_structured_data: usize,
    pub no_semantic_html: usize,
    pub not_answerable: usize,
    pub no_question_headings: usize,
    pub thin: usize,
}

/// Issues collapsed to one entry per rule, with a sample of affected URLs —
/// the compact shape agents want instead of the raw per-page list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueGroup {
    pub rule: String,
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    pub count: usize,
    pub sample_urls: Vec<String>,
}

/// A prioritized recommended fix — an issue type ranked by impact, with guidance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub rule: String,
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    /// Number of affected URLs.
    pub count: usize,
    /// Relative priority score (higher = fix first).
    pub impact: f32,
    pub why: String,
    pub how_to_fix: String,
}

/// Metadata describing a saved report on disk (for history/listing).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMeta {
    pub id: String,
    pub url: String,
    pub created_at: u64,
    pub total_pages: usize,
    pub errors: usize,
    pub warnings: usize,
    pub health_score: u8,
    pub geo_score: u8,
    /// Average accessibility score, 0–100. `#[serde(default)]` so legacy report
    /// indexes (and DB rows written before the a11y column) still deserialize.
    #[serde(default)]
    pub a11y_score: u8,
}

/// One rule's net change between two crawls — how many URLs newly triggered it
/// (or stopped triggering it), with a sample of those URLs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDelta {
    pub rule: String,
    pub title: String,
    pub category: Category,
    pub severity: Severity,
    /// Number of URLs that gained (or lost) this issue.
    pub count: usize,
    pub sample_urls: Vec<String>,
}

/// A comparison of two saved crawls of the same site: what got better, what got
/// worse, and which pages appeared or disappeared. This is the crawl-over-crawl
/// trend view (Sitebulb-style) that the SQLite store unlocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawlDiff {
    pub old_id: String,
    pub new_id: String,
    pub old_created_at: u64,
    pub new_created_at: u64,
    pub health_before: u8,
    pub health_after: u8,
    /// `health_after - health_before` (positive = improved).
    pub health_delta: i16,
    pub geo_before: u8,
    pub geo_after: u8,
    pub geo_delta: i16,
    #[serde(default)]
    pub a11y_before: u8,
    #[serde(default)]
    pub a11y_after: u8,
    /// `a11y_after - a11y_before` (positive = improved).
    #[serde(default)]
    pub a11y_delta: i16,
    pub pages_before: usize,
    pub pages_after: usize,
    /// URLs present in the new crawl but not the old one.
    pub pages_added: Vec<String>,
    /// URLs present in the old crawl but gone from the new one.
    pub pages_removed: Vec<String>,
    /// Issues newly appearing in the new crawl, grouped by rule.
    pub new_issues: Vec<IssueDelta>,
    /// Issues resolved since the old crawl, grouped by rule.
    pub resolved_issues: Vec<IssueDelta>,
}

/// Streaming progress events emitted during a crawl.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CrawlEvent {
    Started {
        url: String,
    },
    Progress {
        crawled: usize,
        discovered: usize,
        queued: usize,
        current: String,
    },
    Done {
        summary: Summary,
    },
}

/// Errors that abort a crawl before it produces a result.
#[derive(Debug)]
pub enum CrawlError {
    InvalidUrl(String),
    Client(String),
    /// Invalid configuration (e.g. a malformed custom extractor).
    Config(String),
}

impl std::fmt::Display for CrawlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CrawlError::InvalidUrl(m) => write!(f, "invalid url: {m}"),
            CrawlError::Client(m) => write!(f, "http client error: {m}"),
            CrawlError::Config(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for CrawlError {}
