// Projects: saved sites an account owns, re-crawlable on a schedule with
// regression monitoring. This is what makes a Crawlie Cloud account useful —
// history, trends, and set-and-forget crawling.

import type { Env } from "./env";

export type Schedule = "off" | "daily" | "weekly" | "monthly";
const SCHEDULES: Schedule[] = ["off", "daily", "weekly", "monthly"];

export interface Project {
  id: string;
  name: string;
  url: string;
  config: Record<string, unknown> | null;
  schedule: Schedule;
  notify: boolean;
  nextRunAt: number | null;
  lastCrawlAt: number | null;
  lastHealth: number | null;
  lastReport: string | null;
  createdAt: number;
}

const DAY = 86_400_000;
const INTERVAL: Record<Exclude<Schedule, "off">, number> = {
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
};

/** Next scheduled run time (epoch ms), or null when scheduling is off. */
export function nextRun(schedule: Schedule, from: number): number | null {
  return schedule === "off" ? null : from + INTERVAL[schedule];
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    url: String(r.url),
    config: r.config ? (JSON.parse(String(r.config)) as Record<string, unknown>) : null,
    schedule: (SCHEDULES.includes(r.schedule as Schedule) ? r.schedule : "off") as Schedule,
    notify: Number(r.notify) === 1,
    nextRunAt: r.next_run_at == null ? null : Number(r.next_run_at),
    lastCrawlAt: r.last_crawl_at == null ? null : Number(r.last_crawl_at),
    lastHealth: r.last_health == null ? null : Number(r.last_health),
    lastReport: r.last_report == null ? null : String(r.last_report),
    createdAt: Number(r.created_at),
  };
}

function id(): string {
  return crypto.randomUUID().slice(0, 12);
}

export async function listProjects(env: Env, userId: string): Promise<Project[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(rowToProject);
}

export async function getProject(env: Env, userId: string, pid: string): Promise<Project | null> {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE user_id = ? AND id = ?`)
    .bind(userId, pid)
    .first<Record<string, unknown>>();
  return row ? rowToProject(row) : null;
}

export async function createProject(
  env: Env,
  userId: string,
  input: { name?: string; url: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> },
  now: number,
): Promise<Project> {
  const pid = id();
  const schedule: Schedule = SCHEDULES.includes(input.schedule as Schedule)
    ? (input.schedule as Schedule)
    : "off";
  let name = input.name?.trim();
  if (!name) {
    try {
      name = new URL(input.url).host;
    } catch {
      name = input.url;
    }
  }
  await env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, url, config, schedule, notify, next_run_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      pid,
      userId,
      name,
      input.url,
      input.config ? JSON.stringify(input.config) : null,
      schedule,
      input.notify === false ? 0 : 1,
      nextRun(schedule, now),
      now,
    )
    .run();
  return (await getProject(env, userId, pid))!;
}

export async function updateProject(
  env: Env,
  userId: string,
  pid: string,
  patch: { name?: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> | null },
  now: number,
): Promise<Project | null> {
  const p = await getProject(env, userId, pid);
  if (!p) return null;
  const schedule: Schedule = patch.schedule && SCHEDULES.includes(patch.schedule) ? patch.schedule : p.schedule;
  const name = patch.name?.trim() || p.name;
  const notify = patch.notify == null ? p.notify : patch.notify;
  const config = patch.config === undefined ? p.config : patch.config;
  // Recompute next run from the schedule change (anchor on last crawl or now).
  const anchor = p.lastCrawlAt ?? now;
  await env.DB.prepare(
    `UPDATE projects SET name=?, schedule=?, notify=?, config=?, next_run_at=? WHERE user_id=? AND id=?`,
  )
    .bind(name, schedule, notify ? 1 : 0, config ? JSON.stringify(config) : null, nextRun(schedule, anchor), userId, pid)
    .run();
  return getProject(env, userId, pid);
}

export async function deleteProject(env: Env, userId: string, pid: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM projects WHERE user_id = ? AND id = ?`).bind(userId, pid).run();
  // Detach its reports (keep the history rows; they remain user-owned).
  await env.DB.prepare(`UPDATE reports SET project_id = NULL WHERE user_id = ? AND project_id = ?`)
    .bind(userId, pid)
    .run();
}

/** Record the outcome of a crawl against a project + schedule the next run. */
export async function recordCrawl(
  env: Env,
  userId: string,
  pid: string,
  reportId: string,
  health: number,
  now: number,
): Promise<void> {
  const p = await getProject(env, userId, pid);
  await env.DB.prepare(
    `UPDATE projects SET last_crawl_at=?, last_health=?, last_report=?, next_run_at=? WHERE user_id=? AND id=?`,
  )
    .bind(now, health, reportId, p ? nextRun(p.schedule, now) : null, userId, pid)
    .run();
}

/** Health/errors/warnings over time for a project's crawl history. */
export async function projectTrend(env: Env, userId: string, pid: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, health_score, geo_score, a11y_score, errors, warnings, total_pages
       FROM reports WHERE user_id = ? AND project_id = ? ORDER BY created_at ASC`,
  )
    .bind(userId, pid)
    .all<Record<string, number | string>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    at: Number(r.created_at),
    health: Number(r.health_score),
    geo: Number(r.geo_score),
    a11y: Number(r.a11y_score),
    errors: Number(r.errors),
    warnings: Number(r.warnings),
    pages: Number(r.total_pages),
  }));
}

/** Projects whose scheduled crawl is due (for the cron trigger). */
export async function dueProjects(env: Env, now: number, limit: number): Promise<
  Array<{ userId: string; project: Project }>
> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM projects WHERE schedule != 'off' AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC LIMIT ?`,
  )
    .bind(now, limit)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({ userId: String(r.user_id), project: rowToProject(r) }));
}
