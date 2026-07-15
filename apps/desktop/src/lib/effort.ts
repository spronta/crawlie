// Fix-effort tiers for every built-in rule: what fixing it actually takes for
// a typical site operator. Drives "quick win" surfacing — high page impact ×
// low effort — in issue inboxes and reports.
//
//   trivial     — edit a tag, attribute, or line of copy; minutes per page.
//   config      — one server/CMS/robots/sitemap/redirect/header change that
//                 fixes many pages at once.
//   content     — someone has to write or restructure copy, page by page.
//   engineering — needs a developer: JS rendering, URL architecture,
//                 performance, hreflang systems.
//
// Hand-maintained alongside the knowledge base in crawlie-core; unknown rules
// (e.g. custom pack rules) simply have no tier and are never quick wins.

export type RuleEffort = "trivial" | "config" | "content" | "engineering";

export const EFFORT_LABEL: Record<RuleEffort, string> = {
  trivial: "Quick edit",
  config: "Config change",
  content: "Content work",
  engineering: "Engineering",
};

export const RULE_EFFORT: Record<string, RuleEffort> = {
  // response
  "connection-error": "config",
  "server-error": "engineering",
  "client-error": "config",
  redirect: "trivial",
  "redirect-chain": "config",
  "slow-response": "engineering",
  "redirect-loop": "config",
  "redirect-temporary": "config",
  "meta-refresh": "config",

  // links
  "broken-link": "trivial",
  orphan: "content",
  "dead-end": "content",
  "deep-page": "content",
  "too-many-links": "content",
  "nofollow-internal-links": "trivial",
  "generic-anchor-text": "trivial",
  "pagination-broken": "config",

  // url structure
  "url-uppercase": "engineering",
  "url-underscores": "engineering",
  "url-space": "engineering",
  "url-double-slash": "config",
  "url-non-ascii": "engineering",
  "url-too-long": "engineering",
  "url-parameters": "engineering",
  "url-tracking-params": "trivial",
  "url-internal-search": "config",
  "url-repetitive-path": "engineering",
  "url-case-duplicate": "config",
  "url-slash-duplicate": "config",

  // titles & meta
  "title-missing": "trivial",
  "title-too-long": "trivial",
  "title-too-short": "trivial",
  "title-duplicate": "trivial",
  "description-missing": "trivial",
  "description-too-long": "trivial",
  "description-too-short": "trivial",
  "description-duplicate": "trivial",
  "title-multiple": "trivial",
  "description-multiple": "trivial",

  // headings
  "h1-missing": "trivial",
  "h1-multiple": "trivial",
  "h1-too-long": "trivial",
  "h1-duplicate": "trivial",
  "h2-missing": "content",

  // content
  "charset-missing": "trivial",
  "soft-404": "config",
  "lorem-ipsum": "content",
  "thin-content": "content",
  "duplicate-content": "content",
  "spelling-errors": "trivial",
  "near-duplicate": "content",
  "readability-difficult": "content",
  "readability-very-difficult": "content",
  "low-text-ratio": "content",

  // indexability
  noindex: "config",
  nofollow: "config",
  "robots-none": "config",
  "robots-nosnippet": "config",
  "robots-noarchive": "config",
  "robots-noimageindex": "config",
  "robots-unavailable-after": "config",
  "x-robots-noindex": "config",
  "blocked-by-robots": "config",
  "no-robots-txt": "config",
  "sitemap-broken": "config",
  "sitemap-redirect": "config",
  "sitemap-noindex": "config",
  "sitemap-canonicalized": "config",
  "sitemap-too-many-urls": "config",
  "sitemap-too-large": "config",
  "not-in-sitemap": "config",
  "no-sitemap": "config",
  "amp-broken": "engineering",
  "amp-redirect": "config",
  "content-requires-js": "engineering",

  // canonical
  "canonical-missing": "trivial",
  canonicalised: "config",
  "canonical-to-broken": "config",
  "canonical-to-redirect": "config",
  "canonical-cross-host": "config",
  "canonical-conflict": "config",
  "canonical-multiple": "trivial",
  "noindex-canonical-conflict": "config",

  // images
  "image-missing-alt": "trivial",
  "image-too-heavy": "config",
  "image-no-dimensions": "trivial",

  // rendered vs raw (all need a developer in the JS build)
  "render-noindex-raw-only": "engineering",
  "render-noindex-js": "engineering",
  "render-canonical-mismatch": "engineering",
  "render-canonical-js": "engineering",
  "render-title-js": "engineering",
  "render-title-modified": "engineering",
  "render-description-js": "engineering",
  "render-description-modified": "engineering",
  "render-h1-js": "engineering",
  "render-h1-modified": "engineering",
  "render-js-only-links": "engineering",

  // security
  "not-secure": "config",
  "mixed-content": "trivial",
  "no-hsts": "config",
  "https-to-http-link": "trivial",
  "form-to-http": "trivial",
  "protocol-relative-links": "trivial",
  "no-csp": "config",
  "no-content-type-options": "config",
  "no-frame-options": "config",
  "no-referrer-policy": "config",

  // performance
  "no-compression": "config",
  "large-page": "engineering",
  "lcp-poor": "engineering",
  "lcp-needs-improvement": "engineering",
  "cls-poor": "engineering",
  "cls-needs-improvement": "engineering",
  "fcp-slow": "engineering",

  // mobile
  "viewport-missing": "trivial",
  "viewport-multiple": "trivial",

  // international
  "lang-missing": "trivial",
  "hreflang-incomplete": "engineering",
  "hreflang-invalid-code": "trivial",
  "hreflang-broken": "config",
  "hreflang-no-return": "engineering",
  "hreflang-no-x-default": "trivial",

  // social
  "favicon-missing": "trivial",
  "og-missing": "trivial",
  "twitter-missing": "trivial",
  "og-incomplete": "trivial",

  // structured data
  "structured-data-missing": "config",
  "structured-data-invalid": "config",
  "schema-missing-required": "config",
  "schema-missing-recommended": "config",

  // accessibility
  "a11y-link-no-text": "trivial",
  "a11y-button-no-text": "trivial",
  "a11y-input-no-label": "trivial",
  "a11y-zoom-disabled": "trivial",
  "a11y-iframe-no-title": "trivial",
  "a11y-positive-tabindex": "trivial",
  "a11y-skipped-heading": "content",
  "a11y-low-contrast": "trivial",
  "a11y-empty-heading": "trivial",
  "a11y-invalid-lang": "trivial",
  "deprecated-html": "engineering",

  // geo
  "geo-no-structured-data": "config",
  "geo-not-answerable": "content",
  "geo-no-author": "content",
  "geo-thin-for-ai": "content",
  "geo-no-semantic-html": "engineering",
  "geo-no-llms-txt": "config",
  "geo-ready": "trivial",
};

export function ruleEffort(rule: string): RuleEffort | undefined {
  return RULE_EFFORT[rule];
}

/** A quick win costs at most one config change — the "fix before lunch" tier. */
export function isQuickWin(rule: string): boolean {
  const effort = RULE_EFFORT[rule];
  return effort === "trivial" || effort === "config";
}
