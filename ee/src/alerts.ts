// Regression alerts — the payoff of scheduled monitoring. When a project's
// scheduled crawl regresses (health drop or new errors), email the owner via
// Loops. Requires LOOPS_ALERT_TRANSACTIONAL_ID (a Loops transactional template
// referencing the data variables below); silently skipped until it's set.

import type { Env } from "./env";

const LOOPS_BASE = "https://app.loops.so/api/v1";

export interface Regression {
  projectName: string;
  url: string;
  healthBefore: number;
  healthAfter: number;
  newErrors: number;
  newWarnings: number;
  reportUrl: string;
}

export async function sendRegressionAlert(env: Env, email: string, r: Regression): Promise<boolean> {
  if (!env.LOOPS_API_KEY || !env.LOOPS_ALERT_TRANSACTIONAL_ID) return false;
  try {
    const res = await fetch(`${LOOPS_BASE}/transactional`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LOOPS_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        transactionalId: env.LOOPS_ALERT_TRANSACTIONAL_ID,
        email,
        dataVariables: {
          projectName: r.projectName,
          url: r.url,
          healthBefore: String(r.healthBefore),
          healthAfter: String(r.healthAfter),
          newErrors: String(r.newErrors),
          newWarnings: String(r.newWarnings),
          reportUrl: r.reportUrl,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Post a regression alert to a project webhook (Slack/Discord/generic `text`). */
export async function sendWebhookAlert(url: string, r: Regression): Promise<boolean> {
  try {
    const lines = [
      `:warning: *${r.projectName}* regressed`,
      r.url,
      `Health ${r.healthBefore} → ${r.healthAfter}`,
    ];
    if (r.newErrors) lines.push(`New errors: ${r.newErrors}`);
    if (r.newWarnings) lines.push(`New warnings: ${r.newWarnings}`);
    lines.push(r.reportUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Look up a user's email from the Better Auth `user` table. */
export async function userEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT email FROM user WHERE id = ?`)
    .bind(userId)
    .first<{ email?: string }>();
  return row?.email ?? null;
}
