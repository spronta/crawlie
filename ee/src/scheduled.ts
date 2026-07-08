// Cron trigger — the monitoring engine. Runs each due scheduled project's
// crawl in the container, stores the report, and emails the owner if it
// regressed versus the last crawl. Sitebulb Cloud charges for this; here it's
// the core of a useful account.

import type { Env } from "./env";
import { dueProjects, recordCrawl, type Project } from "./projects";
import { runCrawl } from "./crawler";
import { saveReport, diffReports } from "./reports";
import { sendRegressionAlert, sendWebhookAlert, userEmail } from "./alerts";
import { incrementCrawls } from "./teams";
import { enabledPackSources } from "./packs";

// Health drop (points) that counts as a regression on its own.
const HEALTH_DROP = 3;
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
    ctx.waitUntil(runScheduled(env, teamId, project, now));
  }
}

async function runScheduled(env: Env, teamId: string, project: Project, now: number): Promise<void> {
  try {
    const config = { url: project.url, ...(project.config ?? {}) };
    const packs = await enabledPackSources(env, teamId);
    const result = (await runCrawl(env, config, () => {}, packs)) as {
      summary?: { healthScore: number; errors: number; warnings: number };
      packs?: { totalScore?: number };
    };
    const health = result.summary?.healthScore ?? 0;

    const before = project.lastHealth;
    const prevReport = project.lastReport;
    // Team owner is the report creator for scheduled crawls.
    const owner = await env.DB.prepare(`SELECT owner_id FROM teams WHERE id = ?`).bind(teamId).first<{ owner_id: string }>();
    const reportId = await saveReport(env, teamId, owner?.owner_id ?? teamId, result as Parameters<typeof saveReport>[3], project.id);
    await incrementCrawls(env, teamId);
    await recordCrawl(env, teamId, project.id, reportId, health, now);

    if (!project.notify) return;

    // Regression = health dropped meaningfully OR new error-level issues appeared.
    let regressed = before != null && health <= before - HEALTH_DROP;
    let newErrors = 0;
    let newWarnings = 0;
    if (prevReport) {
      const diff = await diffReports(env, teamId, prevReport, reportId);
      if (diff) {
        for (const i of diff.newIssues) {
          if (i.severity === "error") newErrors += i.count;
          else if (i.severity === "warning") newWarnings += i.count;
        }
        if (newErrors > 0) regressed = true;
      }
    }

    // Content regression: rule-pack violations increased vs the previous crawl.
    const newPackScore = result.packs?.totalScore ?? null;
    if (newPackScore != null && prevReport) {
      const prev = await env.DB.prepare(`SELECT pack_score FROM reports WHERE team_id = ? AND id = ?`).bind(teamId, prevReport).first<{ pack_score: number | null }>();
      if (prev?.pack_score != null && newPackScore > prev.pack_score + 0.5) regressed = true;
    }

    if (!regressed) return;

    const alert = {
      projectName: project.name,
      url: project.url,
      healthBefore: before ?? health,
      healthAfter: health,
      newErrors,
      newWarnings,
      reportUrl: `https://crawlie.app/projects/${project.id}`,
    };
    const email = owner?.owner_id ? await userEmail(env, owner.owner_id) : null;
    if (email) await sendRegressionAlert(env, email, alert);
    if (project.notifyWebhook) await sendWebhookAlert(project.notifyWebhook, alert);
  } catch (err) {
    console.error(`scheduled crawl failed for project ${project.id}:`, err);
  }
}
