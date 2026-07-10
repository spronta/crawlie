// Mirrors the serde types in crawlie-core (camelCase JSON).

export type Severity = "error" | "warning" | "notice" | "good";

export type Category =
  | "response"
  | "indexability"
  | "links"
  | "url"
  | "titles-meta"
  | "headings"
  | "content"
  | "images"
  | "canonical"
  | "security"
  | "performance"
  | "mobile"
  | "international"
  | "social"
  | "structured-data"
  | "accessibility"
  | "geo"
  | "custom";

export type CrawlMode = "site" | "page" | "list";

/** A host/path exclusion rule: substring match by default, or regex. */
export interface UrlFilter {
  value: string;
  regex: boolean;
}

export interface CrawlConfig {
  url: string;
  mode: CrawlMode;
  urls: string[];
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  timeoutSecs: number;
  userAgent: string;
  checkExternal: boolean;
  respectRobots: boolean;
  useSitemap: boolean;
  include: string[];
  exclude: string[];
  /** Exclude discovered URLs whose host matches (substring or regex). */
  excludeHosts: UrlFilter[];
  /** Exclude discovered URLs whose path matches (substring or regex). */
  excludePaths: UrlFilter[];
  /** Render each page with headless Chrome before auditing (sees JS-injected content). */
  render: boolean;
  /** Extra settle delay (ms) after navigation for late hydration; only used when render is on. */
  renderWaitMs: number;
}

export interface Redirect {
  from: string;
  to: string;
  status: number;
}

export interface Hreflang {
  lang: string;
  href: string;
}

export interface GeoSignals {
  semanticHtml: boolean;
  structuredData: boolean;
  hasAuthor: boolean;
  hasDate: boolean;
  faqSchema: boolean;
  questionHeadings: number;
  structuredBlocks: number;
  answerable: boolean;
  score: number;
}

export interface Page {
  url: string;
  finalUrl: string;
  status: number;
  redirectChain: Redirect[];
  contentType: string | null;
  responseTimeMs: number;
  sizeBytes: number;
  depth: number;
  server: string | null;
  contentEncoding: string | null;
  cacheControl: string | null;
  xRobotsTag: string | null;
  hsts: boolean;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2Count: number;
  h3Count: number;
  wordCount: number;
  textRatio: number;
  canonical: string | null;
  metaRobots: string | null;
  lang: string | null;
  hasViewport: boolean;
  indexable: boolean;
  indexability: string | null;
  canonicalized: boolean;
  imagesTotal: number;
  imagesMissingAlt: number;
  /** Resolved img src URLs (deduped, capped; older reports omit). */
  imageUrls?: string[];
  internalLinks: string[];
  externalLinks: string[];
  inlinks: number;
  linkScore: number;
  seoScore: number;
  ogTitle: string | null;
  ogImage: string | null;
  /** Open Graph description (`og:description`); older reports omit it. */
  ogDescription?: string | null;
  twitterCard: string | null;
  schemaTypes: string[];
  hreflang: Hreflang[];
  mixedContent: number;
  /** Response-vs-render differences (render mode; absent when none). */
  renderDiff?: RenderDiff | null;
  /** Lab Core Web Vitals from the headless browser (render mode only). */
  webVitals?: WebVitals | null;
  /** Recommended HTTP security headers present (older reports omit this). */
  secHeaders?: SecurityHeaders;
  /** Head/markup hygiene signals (older reports omit this). */
  markup?: MarkupSignals;
  geo: GeoSignals;
  contentHash: string | null;
  duplicateOf: string | null;
  /** 64-bit simhash (hex) for near-duplicate detection (older reports omit). */
  simhash?: string | null;
  /** Flesch Reading Ease, when the page had enough English text to score. */
  readability?: number | null;
  error: string | null;
}

/** Lab Core Web Vitals captured during a rendered crawl. */
export interface WebVitals {
  lcpMs: number;
  cls: number;
  fcpMs: number;
}

/** Raw-HTML vs rendered-DOM head-signal differences (render mode only). */
export interface RenderDiff {
  noindexRawOnly: boolean;
  noindexRenderedOnly: boolean;
  canonicalRenderedOnly: boolean;
  canonicalMismatch: boolean;
  titleRenderedOnly: boolean;
  titleModified: boolean;
  descriptionRenderedOnly: boolean;
  descriptionModified: boolean;
  h1RenderedOnly: boolean;
  h1Modified: boolean;
  jsOnlyLinks: number;
}

export interface SecurityHeaders {
  csp: boolean;
  xContentTypeOptions: boolean;
  xFrameOptions: boolean;
  referrerPolicy: boolean;
}

export interface MarkupSignals {
  titleCount: number;
  metaDescriptionCount: number;
  canonicalCount: number;
  canonicalConflict: boolean;
  viewportCount: number;
  metaRefresh: string | null;
  hasFavicon: boolean;
  hasCharset: boolean;
  nofollowLinks: number;
  genericAnchors: number;
  formToHttp: boolean;
  imgsNoDimensions: number;
  protocolRelative: number;
  soft404Phrase: boolean;
  loremIpsum: boolean;
  relPrev?: string | null;
  relNext?: string | null;
  ampUrl?: string | null;
}

export interface Issue {
  rule: string;
  title: string;
  category: Category;
  severity: Severity;
  url: string;
  detail: string | null;
}

export interface RuleInfo {
  rule: string;
  title: string;
  category: Category;
  severity: Severity;
  why: string;
  howToFix: string;
  impact: string;
}

export interface Summary {
  totalPages: number;
  errors: number;
  warnings: number;
  notices: number;
  good: number;
  healthScore: number;
  geoScore: number;
  a11yScore: number;
  avgResponseMs: number;
  indexablePages: number;
  duplicatePages: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byDepth: Record<string, number>;
  durationMs: number;
}

export interface LinkNode {
  url: string;
  depth: number;
  inlinks: number;
  outlinks: number;
  linkScore: number;
  indexable: boolean;
  status: number;
  orphan: boolean;
  deadEnd: boolean;
}

export interface LinkGraph {
  nodes: LinkNode[];
  /** Directed edges as [fromIndex, toIndex] into `nodes`. */
  edges: [number, number][];
  orphans: number;
  deadEnds: number;
  maxDepth: number;
  avgOutlinks: number;
  reciprocalPairs: number;
  topAuthorities: number[];
  topHubs: number[];
}

/** One dead link target rolled up across the crawl: exact occurrence count
 *  plus the linking pages (capped) — survives lean-report issue capping. */
export interface BrokenLink {
  /** The link target that is broken. */
  url: string;
  /** HTTP status of the target (0 = connection error). */
  status: number;
  /** Total occurrences across the crawl. */
  count: number;
  /** Pages containing the link (deduped, capped) — fix these. */
  sources: string[];
  /** More linking pages exist than are listed in `sources`. */
  sourcesTruncated?: boolean;
  /** Where the link sits on each source page (anchor text + region),
   *  best-effort parallel to `sources`. */
  at?: Array<{ page: string; anchor: string; region: string }>;
}

export interface CrawlResult {
  config: CrawlConfig;
  pages: Page[];
  issues: Issue[];
  /** Broken link targets by URL with counts + linking pages (exact even when `issues` is capped). */
  brokenLinks?: BrokenLink[];
  summary: Summary;
  robotsFound: boolean;
  sitemapUrls: number;
  robotsBlocked: string[];
  llmsTxtFound: boolean;
  linkGraph?: LinkGraph;
  startedAt: number;
  /** Guidance for user-defined check rules present in `issues` (Pro packs). */
  customRules?: RuleInfo[];
  // --- Lean (out-of-core) report extras — present on big hosted crawls ---
  /** Per-rule aggregates with exact counts; `issues` holds only samples when truncated. */
  issueRollup?: IssueRollup[];
  /** `issues` is a capped sample; use `issueRollup`/`summary` for true counts. */
  issuesTruncated?: boolean;
  /** Total crawled pages in the stored report (pages are fetched in chunks). */
  pageCount?: number;
  /** Pages per stored chunk (reports/{id}/pages/{n}.json). */
  pageChunkSize?: number;
  /** Client-set: `pages` holds only the first hydrated chunk window. */
  pagesTruncated?: boolean;
  /** Client-set: the full compact page index (every crawled page) fetched
   *  from the report bundle — lets tables browse the whole crawl while full
   *  Page records load per-chunk on demand. */
  pageIndex?: PageIndexEntry[];
  /** Audit breakdowns for the Insights tab, computed server-side over the
   *  **full** crawl. Absent on legacy reports — the UI then falls back to
   *  computing them client-side from the hydrated page window. */
  insights?: InsightsBreakdown[];
}

/** Semantic colour of an insights segment; the UI maps each to a CSS var. */
export type InsightsTone = "good" | "warn" | "bad" | "critical" | "info" | "muted";

/** One labelled slice of an insights breakdown bar. */
export interface InsightsSegment {
  label: string;
  count: number;
  tone: InsightsTone;
}

/** One audit-breakdown card: a title, its denominator, and its segments. */
export interface InsightsBreakdown {
  title: string;
  total: number;
  bars: InsightsSegment[];
}

/** One compact page-index row from a lean (out-of-core) report — every field
 *  the Pages table shows, for every crawled page, plus the chunk holding the
 *  full Page record. */
export interface PageIndexEntry {
  url: string;
  finalUrl: string;
  status: number;
  depth: number;
  title: string | null;
  indexable: boolean;
  wordCount: number;
  inlinks: number;
  /** Missing on indexes written before it was added. */
  linkScore?: number;
  seoScore: number;
  geoScore: number;
  a11yScore: number;
  responseTimeMs: number;
  sizeBytes: number;
  redirects: number;
  hasExtractions: boolean;
  /** 0-based page-chunk number containing the full page record. */
  chunk: number;
}

/** A row of the Pages table: an index entry, or a view over an in-memory
 *  [`Page`] (in which case `page` is set and detail opens instantly). */
export interface PageRow {
  url: string;
  finalUrl: string;
  status: number;
  depth: number;
  title: string | null;
  indexable: boolean;
  indexability?: string | null;
  wordCount: number;
  inlinks: number;
  linkScore?: number;
  seoScore: number;
  geoScore: number;
  chunk?: number;
  page?: Page;
}

/** Per-rule aggregate carried by lean reports: the exact total plus samples. */
export interface IssueRollup {
  rule: string;
  title: string;
  category: Category;
  severity: Severity;
  count: number;
  sample: Issue[];
}

export interface Fix {
  rule: string;
  title: string;
  category: Category;
  severity: Severity;
  count: number;
  impact: number;
  why: string;
  howToFix: string;
}

export interface ReportMeta {
  id: string;
  url: string;
  createdAt: number;
  totalPages: number;
  errors: number;
  warnings: number;
  healthScore: number;
  geoScore: number;
  a11yScore: number;
}

export interface IssueDelta {
  rule: string;
  title: string;
  category: Category;
  severity: Severity;
  count: number;
  sampleUrls: string[];
}

export interface CrawlDiff {
  oldId: string;
  newId: string;
  oldCreatedAt: number;
  newCreatedAt: number;
  healthBefore: number;
  healthAfter: number;
  healthDelta: number;
  geoBefore: number;
  geoAfter: number;
  geoDelta: number;
  a11yBefore: number;
  a11yAfter: number;
  a11yDelta: number;
  pagesBefore: number;
  pagesAfter: number;
  pagesAdded: string[];
  pagesRemoved: string[];
  newIssues: IssueDelta[];
  resolvedIssues: IssueDelta[];
}

export type CrawlEvent =
  | { type: "started"; url: string }
  | { type: "progress"; crawled: number; discovered: number; queued: number; current: string }
  | { type: "meta"; maxPages: number; capped: boolean }
  | { type: "done"; summary: Summary };

export const CATEGORY_LABELS: Record<Category, string> = {
  response: "Response Codes",
  indexability: "Indexability",
  links: "Links",
  url: "URLs",
  "titles-meta": "Titles & Meta",
  headings: "Headings",
  content: "Content",
  images: "Images",
  canonical: "Canonicals",
  security: "Security",
  performance: "Performance",
  mobile: "Mobile",
  international: "International",
  social: "Social",
  "structured-data": "Structured Data",
  accessibility: "Accessibility",
  geo: "Generative Engine Optimization",
  custom: "Custom rules",
};

export const DEFAULT_CONFIG: CrawlConfig = {
  url: "",
  mode: "site",
  urls: [],
  maxPages: 500,
  maxDepth: 16,
  concurrency: 16,
  timeoutSecs: 15,
  userAgent: "crawlie (+https://crawlie.dev)",
  checkExternal: true,
  respectRobots: true,
  useSitemap: true,
  include: [],
  exclude: [],
  excludeHosts: [],
  excludePaths: [],
  render: false,
  renderWaitMs: 0,
};
