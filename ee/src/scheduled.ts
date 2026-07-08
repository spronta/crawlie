// Cron trigger — the monitoring engine. Runs each due scheduled project's
// crawl in the container, stores the report, and emails the owner if it
// regressed versus the last crawl. Sitebulb Cloud charges for this; here it's
// the core of a useful account.

import type { Env } from "./env";
import { dueProjects, recordCrawl, type Project } from "./projects";
import { runCrawl } from "./crawler";
import { saveReport, diffReports } from "./reports";
import { sendRegressionAlert, userEmail } from "./alerts";

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
  for (const { userId, project } of due) {
    ctx.waitUntil(runScheduled(env, userId, project, now));
  }
}

async function runScheduled(env: Env, userId: string, project: Project, now: number): Promise<void> {
  try {
    const config = { url: project.url, ...(project.config ?? {}) };
    const result = (await runCrawl(env, config, () => {})) as {
      summary?: { healthScore: number; errors: number; warnings: number };
    };
    const health = result.summary?.healthScore ?? 0;

    const before = project.lastHealth;
    const prevReport = project.lastReport;
    const reportId = await saveReport(env, userId, result as Parameters<typeof saveReport>[2], project.id);
    await recordCrawl(env, userId, project.id, reportId, health, now);

    if (!project.notify) return;

    // Regression = health dropped meaningfully OR new error-level issues appeared.
    let regressed = before != null && health <= before - HEALTH_DROP;
    let newErrors = 0;
    let newWarnings = 0;
    if (prevReport) {
      const diff = await diffReports(env, userId, prevReport, reportId);
      if (diff) {
        for (const i of diff.newIssues) {
          if (i.severity === "error") newErrors += i.count;
          else if (i.severity === "warning") newWarnings += i.count;
        }
        if (newErrors > 0) regressed = true;
      }
    }
    if (!regressed) return;

    const email = await userEmail(env, userId);
    if (email) {
      await sendRegressionAlert(env, email, {
        projectName: project.name,
        url: project.url,
        healthBefore: before ?? health,
        healthAfter: health,
        newErrors,
        newWarnings,
        reportUrl: `https://crawlie.app/projects/${project.id}`,
      });
    }
  } catch (err) {
    console.error(`scheduled crawl failed for project ${project.id}:`, err);
  }
}
