// Mirrors the serde types in crawlie-core (camelCase JSON).

export type Severity = "error" | "warning" | "notice" | "good";

export type Category =
  | "response"
  | "indexability"
  | "links"
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
  | "geo";

export type CrawlMode = "site" | "page" | "list";

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
  internalLinks: string[];
  externalLinks: string[];
  inlinks: number;
  linkScore: number;
  seoScore: number;
  ogTitle: string | null;
  ogImage: string | null;
  twitterCard: string | null;
  schemaTypes: string[];
  hreflang: Hreflang[];
  mixedContent: number;
  geo: GeoSignals;
  contentHash: string | null;
  duplicateOf: string | null;
  error: string | null;
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
  avgResponseMs: number;
  indexablePages: number;
  duplicatePages: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  byDepth: Record<string, number>;
  durationMs: number;
}

export interface CrawlResult {
  config: CrawlConfig;
  pages: Page[];
  issues: Issue[];
  summary: Summary;
  robotsFound: boolean;
  sitemapUrls: number;
  robotsBlocked: string[];
  llmsTxtFound: boolean;
  startedAt: number;
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
  | { type: "done"; summary: Summary };

export const CATEGORY_LABELS: Record<Category, string> = {
  response: "Response Codes",
  indexability: "Indexability",
  links: "Links",
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
  geo: "Generative Engine Optimization",
};

export const DEFAULT_CONFIG: CrawlConfig = {
  url: "",
  mode: "site",
  urls: [],
  maxPages: 500,
  maxDepth: 16,
  concurrency: 16,
  timeoutSecs: 15,
  userAgent: "crawlie/0.1.0 (+https://spronta.com/crawlie)",
  checkExternal: true,
  respectRobots: true,
  useSitemap: true,
  include: [],
  exclude: [],
  render: false,
  renderWaitMs: 0,
};
