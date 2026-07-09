// Report storage for hosted crawls: metadata in D1 (fast listing + ownership),
// report JSON in R2. Scoped by team_id; user_id records the creator.
//
// Big (out-of-core) crawls are stored as a bundle rather than one giant JSON:
//   reports/{team}/{id}.json             — lean report (no pages; issue rollup)
//   reports/{team}/{id}/index.json       — compact per-page index rows
//   reports/{team}/{id}/pages/{n}.json   — full Page records, chunk n
// Legacy reports are a single {id}.json with pages inline; loadReport serves
// both shapes and the dashboard hydrates pages from chunks when they're absent.

import type { Env } from "./env";

interface Summary {
  totalPages: number;
  errors: number;
  warnings: number;
  healthScore: number;
  geoScore: number;
  a11yScore: number;
}
interface Issue {
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
interface CrawlResult {
  startedAt: number;
  config: { url: string };
  summary: Summary;
  pages?: { url: string }[];
  issues?: Issue[];
  issueRollup?: IssueRollup[];
  packs?: { totalScore?: number } | null;
}
interface ReportMeta {
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

function slug(url: string): string {
  try {
    return new URL(url).host.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch {
    return "site";
  }
}

/** Deterministic report id — derived from the crawl, so retries are idempotent. */
export function reportIdFor(startedAt: number, url: string): string {
  return `${startedAt}-${slug(url)}`;
}

/** R2 key of a report's main JSON (lean for big crawls, full for legacy). */
export const reportKey = (teamId: string, id: string) => `reports/${teamId}/${id}.json`;
/** R2 key of a report bundle part (`index.json`, `pages/3.json`, …). */
export const reportPartKey = (teamId: string, id: string, part: string) =>
  `reports/${teamId}/${id}/${part}`;

/** Insert (or overwrite) the D1 listing row for a saved report. */
export async function saveReportRow(
  env: Env,
  teamId: string,
  creatorId: string,
  id: string,
  row: {
    url: string;
    createdAt: number;
    totalPages: number;
    errors: number;
    warnings: number;
    healthScore: number;
    geoScore: number;
    a11yScore: number;
    projectId: string | null;
    packScore: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO reports
       (id, user_id, team_id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score, project_id, pack_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      creatorId,
      teamId,
      row.url,
      row.createdAt,
      row.totalPages,
      row.errors,
      row.warnings,
      row.healthScore,
      row.geoScore,
      row.a11yScore,
      row.projectId ?? null,
      row.packScore,
    )
    .run();
}

/** Legacy one-shot save (small in-memory results). Kept for compatibility. */
export async function saveReport(
  env: Env,
  teamId: string,
  creatorId: string,
  result: CrawlResult,
  projectId?: string | null,
): Promise<string> {
  const id = reportIdFor(result.startedAt, result.config.url);
  await env.REPORTS.put(reportKey(teamId, id), JSON.stringify(result), {
    httpMetadata: { contentType: "application/json" },
  });
  const s = result.summary;
  const packScore = result.packs && typeof result.packs.totalScore === "number" ? result.packs.totalScore : null;
  await saveReportRow(env, teamId, creatorId, id, {
    url: result.config.url,
    createdAt: result.startedAt,
    totalPages: s.totalPages,
    errors: s.errors,
    warnings: s.warnings,
    healthScore: s.healthScore,
    geoScore: s.geoScore,
    a11yScore: s.a11yScore,
    projectId: projectId ?? null,
    packScore,
  });
  return id;
}

export async function listReports(env: Env, teamId: string, projectId?: string): Promise<ReportMeta[]> {
  const sql =
    `SELECT id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score` +
    ` FROM reports WHERE team_id = ?` +
    (projectId ? ` AND project_id = ?` : ``) +
    ` ORDER BY created_at DESC`;
  const stmt = projectId ? env.DB.prepare(sql).bind(teamId, projectId) : env.DB.prepare(sql).bind(teamId);
  const { results } = await stmt.all<Record<string, number | string>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    url: String(r.url),
    createdAt: Number(r.created_at),
    totalPages: Number(r.total_pages),
    errors: Number(r.errors),
    warnings: Number(r.warnings),
    healthScore: Number(r.health_score),
    geoScore: Number(r.geo_score),
    a11yScore: Number(r.a11y_score),
  }));
}

/** All audits of a project: crawls tied to it PLUS ad-hoc crawls of the same
 *  URL (project_id NULL) — so nothing about the site is hidden. */
export async function projectHistory(env: Env, teamId: string, projectId: string, url: string): Promise<ReportMeta[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score
       FROM reports
      WHERE team_id = ? AND (project_id = ? OR (project_id IS NULL AND url = ?))
      ORDER BY created_at DESC`,
  )
    .bind(teamId, projectId, url)
    .all<Record<string, number | string>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    url: String(r.url),
    createdAt: Number(r.created_at),
    totalPages: Number(r.total_pages),
    errors: Number(r.errors),
    warnings: Number(r.warnings),
    healthScore: Number(r.health_score),
    geoScore: Number(r.geo_score),
    a11yScore: Number(r.a11y_score),
  }));
}

export async function loadReport(env: Env, teamId: string, id: string): Promise<CrawlResult | null> {
  const obj = await env.REPORTS.get(reportKey(teamId, id));
  return obj ? obj.json<CrawlResult>() : null;
}

/**
 * Stream a report bundle part (page chunk / index) straight out of R2 —
 * the Worker never buffers it. Parts are stored gzipped (contentEncoding on
 * the R2 object); they're served compressed with `encodeBody: "manual"` so
 * the runtime passes the stored bytes through and the browser inflates them.
 */
export async function reportPart(
  env: Env,
  teamId: string,
  id: string,
  part: string,
): Promise<Response | null> {
  const obj = await env.REPORTS.get(reportPartKey(teamId, id, part));
  if (!obj) return null;
  const gzip = obj.httpMetadata?.contentEncoding === "gzip";
  return new Response(obj.body, {
    encodeBody: "manual",
    headers: {
      "content-type": "application/json",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

/** Read a bundle part as JSON inside the Worker (inflating stored gzip). */
export async function readPartJson<T>(
  env: Env,
  teamId: string,
  id: string,
  part: string,
): Promise<T | null> {
  const obj = await env.REPORTS.get(reportPartKey(teamId, id, part));
  if (!obj) return null;
  if (obj.httpMetadata?.contentEncoding === "gzip" && obj.body) {
    const inflated = obj.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(inflated).json<T>();
  }
  return obj.json<T>();
}

export async function deleteReport(env: Env, teamId: string, id: string): Promise<void> {
  await env.REPORTS.delete(reportKey(teamId, id));
  // Bundle parts (index + page chunks) live under the id's prefix.
  const prefix = `reports/${teamId}/${id}/`;
  for (;;) {
    const listing = await env.REPORTS.list({ prefix, limit: 500 });
    if (listing.objects.length === 0) break;
    await env.REPORTS.delete(listing.objects.map((o) => o.key));
    if (!listing.truncated) break;
  }
  await env.DB.prepare(`DELETE FROM reports WHERE team_id = ? AND id = ?`).bind(teamId, id).run();
}

// --- Public sharing ----------------------------------------------------
export async function shareReport(env: Env, teamId: string, id: string): Promise<string | null> {
  const existing = await env.DB.prepare(`SELECT share_token FROM reports WHERE team_id = ? AND id = ?`).bind(teamId, id).first<{ share_token?: string }>();
  if (!existing) return null;
  if (existing.share_token) return existing.share_token;
  const token = crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(`UPDATE reports SET share_token = ? WHERE team_id = ? AND id = ?`).bind(token, teamId, id).run();
  return token;
}

export async function unshareReport(env: Env, teamId: string, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE reports SET share_token = NULL WHERE team_id = ? AND id = ?`).bind(teamId, id).run();
}

export async function reportShareToken(env: Env, teamId: string, id: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT share_token FROM reports WHERE team_id = ? AND id = ?`).bind(teamId, id).first<{ share_token?: string }>();
  return row?.share_token ?? null;
}

/** Resolve a public share token to its {teamId, id}, or null. */
export async function resolveShareToken(env: Env, token: string): Promise<{ teamId: string; id: string } | null> {
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT team_id, id FROM reports WHERE share_token = ?`).bind(token).first<{ team_id: string; id: string }>();
  return row ? { teamId: row.team_id, id: row.id } : null;
}

export async function loadPublicReport(env: Env, token: string): Promise<CrawlResult | null> {
  const ref = await resolveShareToken(env, token);
  if (!ref) return null;
  const obj = await env.REPORTS.get(reportKey(ref.teamId, ref.id));
  return obj ? obj.json<CrawlResult>() : null;
}

/** The set of crawled URLs in a report — pages when inline, else the index. */
async function reportUrls(env: Env, teamId: string, id: string, r: CrawlResult): Promise<Set<string>> {
  if (r.pages && r.pages.length > 0) return new Set(r.pages.map((p) => p.url));
  const index = await readPartJson<Array<{ url: string }>>(env, teamId, id, "index.json");
  return new Set((index ?? []).map((e) => e.url));
}

/** Per-rule issue aggregates — the rollup when present (exact counts even for
 *  lean reports), else recomputed from the inline issue list. */
function reportByRule(r: CrawlResult) {
  const m = new Map<string, { rule: string; title: string; category: string; severity: string; count: number; sampleUrls: string[] }>();
  if (r.issueRollup && r.issueRollup.length > 0) {
    for (const g of r.issueRollup) {
      m.set(g.rule, {
        rule: g.rule,
        title: g.title,
        category: g.category,
        severity: g.severity,
        count: g.count,
        sampleUrls: g.sample.map((i) => i.url ?? "").filter(Boolean).slice(0, 5),
      });
    }
    return m;
  }
  for (const i of r.issues ?? []) {
    const e = m.get(i.rule) ?? { rule: i.rule, title: i.title, category: i.category, severity: i.severity, count: 0, sampleUrls: [] };
    e.count++;
    if (i.url && e.sampleUrls.length < 5) e.sampleUrls.push(i.url);
    m.set(i.rule, e);
  }
  return m;
}

// Crawl-over-crawl diff, computed from the two stored results (lean-aware).
export async function diffReports(env: Env, teamId: string, oldId: string, newId: string) {
  const [oldR, newR] = await Promise.all([loadReport(env, teamId, oldId), loadReport(env, teamId, newId)]);
  if (!oldR || !newR) return null;

  const [oldUrls, newUrls] = await Promise.all([
    reportUrls(env, teamId, oldId, oldR),
    reportUrls(env, teamId, newId, newR),
  ]);
  // Cap the URL churn lists so a six-figure crawl can't produce a huge diff.
  const URL_LIST_CAP = 2_000;
  const pagesAdded = [...newUrls].filter((u) => !oldUrls.has(u)).slice(0, URL_LIST_CAP);
  const pagesRemoved = [...oldUrls].filter((u) => !newUrls.has(u)).slice(0, URL_LIST_CAP);

  const oldByRule = reportByRule(oldR);
  const newByRule = reportByRule(newR);
  const newIssues = [...newByRule.values()].filter((i) => !oldByRule.has(i.rule));
  const resolvedIssues = [...oldByRule.values()].filter((i) => !newByRule.has(i.rule));

  return {
    oldId,
    newId,
    oldCreatedAt: oldR.startedAt,
    newCreatedAt: newR.startedAt,
    healthBefore: oldR.summary.healthScore,
    healthAfter: newR.summary.healthScore,
    healthDelta: newR.summary.healthScore - oldR.summary.healthScore,
    geoBefore: oldR.summary.geoScore,
    geoAfter: newR.summary.geoScore,
    geoDelta: newR.summary.geoScore - oldR.summary.geoScore,
    a11yBefore: oldR.summary.a11yScore,
    a11yAfter: newR.summary.a11yScore,
    a11yDelta: newR.summary.a11yScore - oldR.summary.a11yScore,
    pagesBefore: oldR.summary.totalPages,
    pagesAfter: newR.summary.totalPages,
    pagesAdded,
    pagesRemoved,
    newIssues,
    resolvedIssues,
  };
}
