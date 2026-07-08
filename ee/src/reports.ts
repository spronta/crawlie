// Report storage for hosted crawls: metadata in D1 (fast listing + ownership),
// full CrawlResult JSON in R2 (cheap blob storage). Mirrors the desktop
// ReportStore's surface (list / load / delete / diff) so the dashboard's
// existing ReportsView works unchanged.

import type { Env } from "./env";

// Structural subset of the desktop CrawlResult we need here; the full object is
// stored opaquely in R2 and returned verbatim to the client.
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
interface CrawlResult {
  startedAt: number;
  config: { url: string };
  summary: Summary;
  pages?: { url: string }[];
  issues?: Issue[];
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

const key = (userId: string, id: string) => `reports/${userId}/${id}.json`;

export async function saveReport(
  env: Env,
  userId: string,
  result: CrawlResult,
  projectId?: string | null,
): Promise<string> {
  const id = `${result.startedAt}-${slug(result.config.url)}`;
  await env.REPORTS.put(key(userId, id), JSON.stringify(result), {
    httpMetadata: { contentType: "application/json" },
  });
  const s = result.summary;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO reports
       (id, user_id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score, project_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, userId, result.config.url, result.startedAt, s.totalPages, s.errors, s.warnings, s.healthScore, s.geoScore, s.a11yScore, projectId ?? null)
    .run();
  return id;
}

export async function listReports(env: Env, userId: string, projectId?: string): Promise<ReportMeta[]> {
  const sql =
    `SELECT id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score, project_id` +
    ` FROM reports WHERE user_id = ?` +
    (projectId ? ` AND project_id = ?` : ``) +
    ` ORDER BY created_at DESC`;
  const stmt = projectId
    ? env.DB.prepare(sql).bind(userId, projectId)
    : env.DB.prepare(sql).bind(userId);
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

export async function loadReport(env: Env, userId: string, id: string): Promise<CrawlResult | null> {
  const obj = await env.REPORTS.get(key(userId, id));
  if (!obj) return null;
  return obj.json<CrawlResult>();
}

export async function deleteReport(env: Env, userId: string, id: string): Promise<void> {
  await env.REPORTS.delete(key(userId, id));
  await env.DB.prepare(`DELETE FROM reports WHERE user_id = ? AND id = ?`).bind(userId, id).run();
}

// --- Public sharing ----------------------------------------------------

/** Publish a report to a public token; returns the token. */
export async function shareReport(env: Env, userId: string, id: string): Promise<string | null> {
  const existing = await env.DB.prepare(`SELECT share_token FROM reports WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<{ share_token?: string }>();
  if (!existing) return null;
  if (existing.share_token) return existing.share_token;
  const token = crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(`UPDATE reports SET share_token = ? WHERE user_id = ? AND id = ?`)
    .bind(token, userId, id)
    .run();
  return token;
}

export async function unshareReport(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE reports SET share_token = NULL WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .run();
}

/** Get a report's current share token (null if not shared). */
export async function reportShareToken(env: Env, userId: string, id: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT share_token FROM reports WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first<{ share_token?: string }>();
  return row?.share_token ?? null;
}

/** Load a publicly-shared report by its token (no auth). */
export async function loadPublicReport(env: Env, token: string): Promise<CrawlResult | null> {
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT user_id, id FROM reports WHERE share_token = ?`)
    .bind(token)
    .first<{ user_id: string; id: string }>();
  if (!row) return null;
  const obj = await env.REPORTS.get(key(row.user_id, row.id));
  return obj ? obj.json<CrawlResult>() : null;
}

// Crawl-over-crawl diff, computed from the two stored results (JS mirror of the
// desktop ReportStore::diff so the Compare UI works on hosted reports).
export async function diffReports(env: Env, userId: string, oldId: string, newId: string) {
  const [oldR, newR] = await Promise.all([
    loadReport(env, userId, oldId),
    loadReport(env, userId, newId),
  ]);
  if (!oldR || !newR) return null;

  const urls = (r: CrawlResult) => new Set((r.pages ?? []).map((p) => p.url));
  const oldUrls = urls(oldR);
  const newUrls = urls(newR);
  const pagesAdded = [...newUrls].filter((u) => !oldUrls.has(u));
  const pagesRemoved = [...oldUrls].filter((u) => !newUrls.has(u));

  const byRule = (r: CrawlResult) => {
    const m = new Map<string, { rule: string; title: string; category: string; severity: string; count: number; sampleUrls: string[] }>();
    for (const i of r.issues ?? []) {
      const e = m.get(i.rule) ?? { rule: i.rule, title: i.title, category: i.category, severity: i.severity, count: 0, sampleUrls: [] };
      e.count++;
      if (i.url && e.sampleUrls.length < 5) e.sampleUrls.push(i.url);
      m.set(i.rule, e);
    }
    return m;
  };
  const oldByRule = byRule(oldR);
  const newByRule = byRule(newR);
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
