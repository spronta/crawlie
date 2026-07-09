// Bridge from the Worker to the hosted crawl runtime: a Cloudflare Container
// managed by the CrawlerContainer Durable Object. Crawls run as out-of-core
// jobs keyed by jobId; the DO watches the job and persists the report, so the
// Worker only ever starts jobs and reads watch state.

import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env";
import type { WatchInfo, WatchState } from "./containers";

const jobContainer = (env: Env, jobId: string) => getContainer(env.CRAWLER, jobId);

/** Kick off a crawl job in its own container instance; returns immediately. */
export async function startJob(
  env: Env,
  jobId: string,
  config: unknown,
  packs: Array<{ name: string; source: string }>,
): Promise<void> {
  const res = await jobContainer(env, jobId).fetch(
    new Request("http://crawler/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, ...(config as Record<string, unknown>), packs }),
    }),
  );
  if (!res.ok) throw new Error(`Crawler start returned ${res.status}`);
}

/**
 * Arm the Durable Object's watcher for a started job. From here on the DO
 * drives the crawl to completion — polling, saving to R2/D1, metering,
 * alerts — even if no browser ever polls again.
 */
export async function armWatch(env: Env, info: WatchInfo): Promise<void> {
  const res = await jobContainer(env, info.jobId).fetch(
    new Request("http://crawler/__watch/arm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(info),
    }),
  );
  if (!res.ok) throw new Error(`Watch arm returned ${res.status}`);
}

/** Snapshot a job from the DO watcher (progress / saving / done / error). */
export async function watchState(env: Env, jobId: string): Promise<WatchState> {
  const res = await jobContainer(env, jobId).fetch(
    new Request("http://crawler/__watch/state"),
  );
  if (!res.ok) throw new Error(`Watch state returned ${res.status}`);
  return res.json<WatchState>();
}

// ----- Active-crawl registry (D1) ---------------------------------------
// Lets the dashboard list a team's running jobs and reattach after a page
// reload. Rows are written at start, deleted when the watcher settles, and
// lazily pruned on read if a watcher died without settling.

export interface ActiveCrawlRow {
  jobId: string;
  teamId: string;
  projectId: string | null;
  url: string;
  maxPages: number;
  startedAt: number;
}

/** Ignore/prune registry rows older than this — no real crawl runs this long. */
const ACTIVE_CRAWL_TTL_MS = 24 * 3600_000;

export async function registerActiveCrawl(env: Env, row: ActiveCrawlRow): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO active_crawls (job_id, team_id, project_id, url, max_pages, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.jobId, row.teamId, row.projectId, row.url, row.maxPages, row.startedAt)
    .run();
}

export async function clearActiveCrawl(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM active_crawls WHERE job_id = ?`).bind(jobId).run();
}

/** A team's running crawls, verified against each job's DO watcher; rows whose
 *  job has settled (or vanished) are pruned as a side effect. */
export async function listActiveCrawls(env: Env, teamId: string): Promise<ActiveCrawlRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT job_id, team_id, project_id, url, max_pages, started_at FROM active_crawls WHERE team_id = ? ORDER BY started_at DESC LIMIT 10`,
  )
    .bind(teamId)
    .all<{ job_id: string; team_id: string; project_id: string | null; url: string; max_pages: number; started_at: number }>();
  const out: ActiveCrawlRow[] = [];
  for (const r of results ?? []) {
    if (Date.now() - r.started_at > ACTIVE_CRAWL_TTL_MS) {
      await clearActiveCrawl(env, r.job_id);
      continue;
    }
    try {
      const st = await watchState(env, r.job_id);
      if (st.status === "running" || st.status === "saving") {
        out.push({ jobId: r.job_id, teamId: r.team_id, projectId: r.project_id, url: r.url, maxPages: r.max_pages, startedAt: r.started_at });
      } else {
        await clearActiveCrawl(env, r.job_id); // settled or unknown — stale row
      }
    } catch {
      /* transient watcher error: keep the row, just omit it this time */
    }
  }
  return out;
}

// Cancel a running job (best-effort — the container stops the crawl and the
// watcher then saves the partial result as a normal report).
export async function cancelCrawl(env: Env, id: string): Promise<void> {
  try {
    await jobContainer(env, id).fetch(
      new Request("http://crawler/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: id }),
      }),
    );
  } catch {
    /* the instance will idle out on its own */
  }
}

/** Validate a pack + dry-run its custom checks against report pages (rule
 *  builder preview). One-shot request; the container replies with JSON. */
export async function previewPack(
  env: Env,
  source: string,
  pages: unknown[],
): Promise<unknown> {
  const container = getContainer(env.CRAWLER, "preview");
  const res = await container.fetch(
    new Request("http://crawler/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, pages }),
    }),
  );
  if (!res.ok) throw new Error(`Preview returned ${res.status}`);
  return res.json();
}
