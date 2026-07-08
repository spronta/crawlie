// Projects: saved sites a TEAM owns, re-crawlable on a schedule with regression
// monitoring. Scoped by team_id (members share them); user_id records the
// creator.

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
const INTERVAL: Record<Exclude<Schedule, "off">, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };

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

const id = () => crypto.randomUUID().slice(0, 12);

export async function listProjects(env: Env, teamId: string): Promise<Project[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC`)
    .bind(teamId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(rowToProject);
}

export async function getProject(env: Env, teamId: string, pid: string): Promise<Project | null> {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE team_id = ? AND id = ?`).bind(teamId, pid).first<Record<string, unknown>>();
  return row ? rowToProject(row) : null;
}

export async function createProject(
  env: Env,
  teamId: string,
  creatorId: string,
  input: { name?: string; url: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> },
  now: number,
): Promise<Project> {
  const pid = id();
  const schedule: Schedule = SCHEDULES.includes(input.schedule as Schedule) ? (input.schedule as Schedule) : "off";
  let name = input.name?.trim();
  if (!name) {
    try {
      name = new URL(input.url).host;
    } catch {
      name = input.url;
    }
  }
  await env.DB.prepare(
    `INSERT INTO projects (id, user_id, team_id, name, url, config, schedule, notify, next_run_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(pid, creatorId, teamId, name, input.url, input.config ? JSON.stringify(input.config) : null, schedule, input.notify === false ? 0 : 1, nextRun(schedule, now), now)
    .run();
  return (await getProject(env, teamId, pid))!;
}

export async function updateProject(
  env: Env,
  teamId: string,
  pid: string,
  patch: { name?: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> | null },
  now: number,
): Promise<Project | null> {
  const p = await getProject(env, teamId, pid);
  if (!p) return null;
  const schedule: Schedule = patch.schedule && SCHEDULES.includes(patch.schedule) ? patch.schedule : p.schedule;
  const name = patch.name?.trim() || p.name;
  const notify = patch.notify == null ? p.notify : patch.notify;
  const config = patch.config === undefined ? p.config : patch.config;
  const anchor = p.lastCrawlAt ?? now;
  await env.DB.prepare(`UPDATE projects SET name=?, schedule=?, notify=?, config=?, next_run_at=? WHERE team_id=? AND id=?`)
    .bind(name, schedule, notify ? 1 : 0, config ? JSON.stringify(config) : null, nextRun(schedule, anchor), teamId, pid)
    .run();
  return getProject(env, teamId, pid);
}

export async function deleteProject(env: Env, teamId: string, pid: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM projects WHERE team_id = ? AND id = ?`).bind(teamId, pid).run();
  await env.DB.prepare(`UPDATE reports SET project_id = NULL WHERE team_id = ? AND project_id = ?`).bind(teamId, pid).run();
}

export async function recordCrawl(env: Env, teamId: string, pid: string, reportId: string, health: number, now: number): Promise<void> {
  const p = await getProject(env, teamId, pid);
  await env.DB.prepare(`UPDATE projects SET last_crawl_at=?, last_health=?, last_report=?, next_run_at=? WHERE team_id=? AND id=?`)
    .bind(now, health, reportId, p ? nextRun(p.schedule, now) : null, teamId, pid)
    .run();
}

export async function projectTrend(env: Env, teamId: string, pid: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, health_score, geo_score, a11y_score, errors, warnings, total_pages
       FROM reports WHERE team_id = ? AND project_id = ? ORDER BY created_at ASC`,
  )
    .bind(teamId, pid)
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

/** Due scheduled projects (for the cron), with their owning team. */
export async function dueProjects(env: Env, now: number, limit: number): Promise<Array<{ teamId: string; project: Project }>> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM projects WHERE schedule != 'off' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?`,
  )
    .bind(now, limit)
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({ teamId: String(r.team_id), project: rowToProject(r) }));
}
