// Report storage for hosted crawls: metadata in D1 (fast listing + ownership),
// full CrawlResult JSON in R2. Scoped by team_id; user_id records the creator.

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
interface CrawlResult {
  startedAt: number;
  config: { url: string };
  summary: Summary;
  pages?: { url: string }[];
  issues?: Issue[];
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

const key = (teamId: string, id: string) => `reports/${teamId}/${id}.json`;

export async function saveReport(
  env: Env,
  teamId: string,
  creatorId: string,
  result: CrawlResult,
  projectId?: string | null,
): Promise<string> {
  const id = `${result.startedAt}-${slug(result.config.url)}`;
  await env.REPORTS.put(key(teamId, id), JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
  const s = result.summary;
  const packScore = result.packs && typeof result.packs.totalScore === "number" ? result.packs.totalScore : null;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO reports
       (id, user_id, team_id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score, project_id, pack_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, creatorId, teamId, result.config.url, result.startedAt, s.totalPages, s.errors, s.warnings, s.healthScore, s.geoScore, s.a11yScore, projectId ?? null, packScore)
    .run();
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
  const obj = await env.REPORTS.get(key(teamId, id));
  return obj ? obj.json<CrawlResult>() : null;
}

export async function deleteReport(env: Env, teamId: string, id: string): Promise<void> {
  await env.REPORTS.delete(key(teamId, id));
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

export async function loadPublicReport(env: Env, token: string): Promise<CrawlResult | null> {
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT team_id, id FROM reports WHERE share_token = ?`).bind(token).first<{ team_id: string; id: string }>();
  if (!row) return null;
  const obj = await env.REPORTS.get(key(row.team_id, row.id));
  return obj ? obj.json<CrawlResult>() : null;
}

// Crawl-over-crawl diff, computed from the two stored results.
export async function diffReports(env: Env, teamId: string, oldId: string, newId: string) {
  const [oldR, newR] = await Promise.all([loadReport(env, teamId, oldId), loadReport(env, teamId, newId)]);
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
