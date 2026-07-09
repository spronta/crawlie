// Compact, pre-digested views of a stored CrawlResult — the same shape the
// stdio MCP server returns, computed in TypeScript from the fields the hosted
// report already carries. Hosted crawls are stored lean: exact per-rule
// aggregates live in `issueRollup` (with a small URL sample), while only small
// legacy reports carry a flat `issues` array. Everything here prefers the
// rollup (exact counts even for six-figure crawls) and falls back to inline
// issues, mirroring reports.ts `reportByRule`, so no Rust scoring is duplicated.

interface Summary {
  totalPages: number;
  errors: number;
  warnings: number;
  notices?: number;
  healthScore: number;
  geoScore: number;
  a11yScore: number;
}

export interface Issue {
  rule: string;
  title: string;
  category: string;
  severity: string;
  url?: string;
}

interface IssueRollup {
  rule: string;
  title: string;
  category: string;
  severity: string;
  count: number;
  sample: Issue[];
}

export interface StoredReport {
  startedAt?: number;
  config?: { url?: string };
  summary: Summary;
  pages?: Array<{ url: string }>;
  issues?: Issue[];
  issueRollup?: IssueRollup[];
  robotsFound?: boolean;
  sitemapFound?: boolean;
  llmsTxtFound?: boolean;
  sitemapUrls?: string[];
}

export interface RuleGroup {
  rule: string;
  title: string;
  category: string;
  severity: string;
  count: number;
  sampleUrls: string[];
}

/** Rank weight for a severity — errors before warnings before notices. */
function severityWeight(sev: string): number {
  switch (sev.toLowerCase()) {
    case "critical":
    case "error":
      return 3;
    case "warning":
    case "warn":
      return 2;
    default:
      return 1;
  }
}

/**
 * Per-rule groups with a count and up to 5 sample URLs. Prefers `issueRollup`
 * (exact counts for lean reports); falls back to counting inline `issues`.
 */
function ruleGroups(report: StoredReport): RuleGroup[] {
  const map = new Map<string, RuleGroup>();
  if (report.issueRollup && report.issueRollup.length > 0) {
    for (const g of report.issueRollup) {
      map.set(g.rule, {
        rule: g.rule,
        title: g.title,
        category: g.category,
        severity: g.severity,
        count: g.count,
        sampleUrls: g.sample.map((i) => i.url ?? "").filter(Boolean).slice(0, 5),
      });
    }
  } else {
    for (const i of report.issues ?? []) {
      const g =
        map.get(i.rule) ??
        { rule: i.rule, title: i.title, category: i.category, severity: i.severity, count: 0, sampleUrls: [] };
      g.count++;
      if (i.url && g.sampleUrls.length < 5) g.sampleUrls.push(i.url);
      map.set(i.rule, g);
    }
  }
  return [...map.values()].sort(
    (a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.count - a.count,
  );
}

/** The prioritized fixes: rules ranked by severity then breadth of impact. */
export function topFixes(report: StoredReport, category: string | undefined, limit = 8): RuleGroup[] {
  const groups = category ? ruleGroups(report).filter((g) => g.category === category) : ruleGroups(report);
  return groups.slice(0, limit);
}

/** Issues grouped by rule with sample URLs (verbose-ish, still compact). */
export function issuesByRule(report: StoredReport, limit = 15): RuleGroup[] {
  return ruleGroups(report).slice(0, limit);
}

/** GEO (AI-readiness) issues only, grouped by rule. */
export function geoIssues(report: StoredReport): RuleGroup[] {
  return ruleGroups(report).filter((g) => g.category === "geo" || g.rule.startsWith("geo-"));
}

/**
 * URLs flagged by a specific rule. Returns the full list for legacy inline
 * reports; for lean reports only the rollup's sample is available (with the
 * exact total), which `sampled` makes explicit.
 */
export function affectedUrls(
  report: StoredReport,
  rule: string,
  limit = 100,
): { rule: string; total: number; urls: string[]; sampled?: boolean } {
  const inline = (report.issues ?? []).filter((i) => i.rule === rule);
  if (inline.length > 0) {
    const urls: string[] = [];
    for (const i of inline) {
      if (i.url && urls.length < limit) urls.push(i.url);
    }
    return { rule, total: inline.length, urls };
  }
  const g = (report.issueRollup ?? []).find((r) => r.rule === rule);
  if (g) {
    return { rule, total: g.count, urls: g.sample.map((i) => i.url ?? "").filter(Boolean).slice(0, limit), sampled: g.count > g.sample.length };
  }
  return { rule, total: 0, urls: [] };
}

function headline(report: StoredReport): string {
  const s = report.summary;
  const top = ruleGroups(report)[0];
  const lead = top ? `${top.title} (${top.count} affected)` : "no issues";
  const notices = typeof s.notices === "number" ? `, ${s.notices} notices` : "";
  return (
    `Health ${s.healthScore}/100 · GEO ${s.geoScore}/100 · A11y ${s.a11yScore}/100 · ` +
    `${s.totalPages} pages · ${s.errors} errors, ${s.warnings} warnings${notices}. Top fix: ${lead}.`
  );
}

/** The compact digest an agent gets back from a crawl or `get_report`. */
export function compactReport(report: StoredReport): Record<string, unknown> {
  const digest: Record<string, unknown> = {
    url: report.config?.url,
    headline: headline(report),
    scores: {
      health: report.summary.healthScore,
      geo: report.summary.geoScore,
      a11y: report.summary.a11yScore,
    },
    summary: report.summary,
    topFixes: topFixes(report, undefined, 8),
    issuesByRule: issuesByRule(report, 15),
    geoIssues: geoIssues(report),
    pageCount: report.pages?.length ?? report.summary.totalPages,
  };
  // Discovery signals are only present on some reports; include when known.
  const discovery: Record<string, unknown> = {};
  if (report.robotsFound !== undefined) discovery.robotsFound = report.robotsFound;
  if (report.sitemapFound !== undefined) discovery.sitemapFound = report.sitemapFound;
  if (report.llmsTxtFound !== undefined) discovery.llmsTxtFound = report.llmsTxtFound;
  if (report.sitemapUrls !== undefined) discovery.sitemapUrlCount = report.sitemapUrls.length;
  if (Object.keys(discovery).length > 0) digest.discovery = discovery;
  return digest;
}
