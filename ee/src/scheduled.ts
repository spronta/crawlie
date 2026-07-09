// Cron trigger — the monitoring engine. Kicks off each due scheduled
// project's crawl as a container job and arms the Durable Object watcher with
// the project's alert context. The DO then owns the whole lifecycle — crawl,
// save, metering, regression detection, notifications — so scheduled crawls
// of any size finish reliably long after this cron invocation has returned.

import type { Env } from "./env";
import { dueProjects, nextRun, type Project } from "./projects";
import { startJob, armWatch, registerActiveCrawl } from "./crawler";
import { enabledPackSources } from "./packs";
import { PLANS, getUsage, type Plan } from "./teams";

// Cap crawls per cron tick so a burst of due projects stays within limits.
const BATCH = 8;

export async function scheduled(
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  const due = await dueProjects(env, now, BATCH);
  for (const { teamId, project } of due) {
    ctx.waitUntil(runScheduled(env, teamId, project));
  }
}

async function runScheduled(env: Env, teamId: string, project: Project): Promise<void> {
  try {
    // Plan limits still apply to scheduled crawls (pages + monthly quota).
    const team = await env.DB.prepare(`SELECT plan, owner_id FROM teams WHERE id = ?`)
      .bind(teamId)
      .first<{ plan?: string; owner_id?: string }>();
    const plan = PLANS[(team?.plan as Plan) ?? "free"] ?? PLANS.free;
    const usage = await getUsage(env, teamId);
    if (usage.crawls >= plan.crawlsPerMonth) return;

    // Claim the slot now: big crawls can outlive several cron ticks, and
    // next_run_at is otherwise only advanced when the report lands
    // (recordCrawl). Without this an hourly tick would double-start them.
    await env.DB.prepare(`UPDATE projects SET next_run_at=? WHERE team_id=? AND id=?`)
      .bind(nextRun(project.schedule, Date.now()), teamId, project.id)
      .run();

    const config: Record<string, unknown> = { url: project.url, ...(project.config ?? {}) };
    const requested = typeof config.maxPages === "number" && config.maxPages > 0 ? config.maxPages : plan.maxPages;
    config.maxPages = Math.min(requested, plan.maxPages);

    const packs = await enabledPackSources(env, teamId);
    const jobId = crypto.randomUUID();
    await startJob(env, jobId, config, packs);
    await armWatch(env, {
      jobId,
      teamId,
      // Team owner is the report creator for scheduled crawls.
      userId: team?.owner_id ?? teamId,
      projectId: project.id,
      scheduled: {
        projectName: project.name,
        notify: !!project.notify,
        notifyWebhook: project.notifyWebhook ?? null,
        lastHealth: project.lastHealth ?? null,
        lastReport: project.lastReport ?? null,
      },
    });
    // Registry row so the dashboard's "Running" section sees scheduled crawls too.
    try {
      await registerActiveCrawl(env, {
        jobId,
        teamId,
        projectId: project.id,
        url: project.url,
        maxPages: Number(config.maxPages),
        startedAt: Date.now(),
      });
    } catch (e) {
      console.error("active-crawl register failed:", e);
    }
  } catch (err) {
    console.error(`scheduled crawl failed for project ${project.id}:`, err);
  }
}
