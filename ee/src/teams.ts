// Teams + plans + usage. A team owns projects/reports; members share them; the
// plan gates limits (metered on hosted crawls — the real COGS). This is the
// commercial substrate the revenue plan's SKUs build on.

import type { Env } from "./env";

export type Plan = "free" | "pro" | "business";

export interface PlanDef {
  id: Plan;
  label: string;
  priceMonthly: number;
  projects: number;
  crawlsPerMonth: number;
  scheduling: boolean;
  /** User-defined check_rule audit packs (agency standards). */
  customRules: boolean;
  /** Hard cap on pages per hosted crawl — bounds crawl duration so the
   *  streaming worker never runs long enough to be evicted mid-crawl. */
  maxPages: number;
  seats: number;
  /** Stripe price env var name (resolved at checkout). */
  stripePriceVar?: "STRIPE_PRICE_PRO" | "STRIPE_PRICE_BUSINESS";
}

export const PLANS: Record<Plan, PlanDef> = {
  free: { id: "free", label: "Free", priceMonthly: 0, projects: 1, crawlsPerMonth: 50, scheduling: false, customRules: false, maxPages: 200, seats: 1 },
  pro: { id: "pro", label: "Pro", priceMonthly: 29, projects: 25, crawlsPerMonth: 2000, scheduling: true, customRules: true, maxPages: 500, seats: 3, stripePriceVar: "STRIPE_PRICE_PRO" },
  business: { id: "business", label: "Business", priceMonthly: 99, projects: 1000, crawlsPerMonth: 20000, scheduling: true, customRules: true, maxPages: 1000, seats: 15, stripePriceVar: "STRIPE_PRICE_BUSINESS" },
};

export interface Team {
  id: string;
  name: string;
  plan: Plan;
  role: string;
  ownerId: string;
  stripeCustomer: string | null;
}

const sid = () => crypto.randomUUID().slice(0, 12);

/** Ensure the user has at least a personal team; returns their default team id.
 *  The personal team id is DETERMINISTIC (u_<userId>) + inserted with OR IGNORE,
 *  so concurrent first-requests converge to ONE team instead of racing to make
 *  duplicates. Ordering is tie-broken by id so "oldest team" is stable. */
export async function ensurePersonalTeam(env: Env, userId: string, email?: string | null): Promise<string> {
  const existing = await env.DB.prepare(`SELECT team_id FROM team_members WHERE user_id = ? ORDER BY created_at ASC, team_id ASC LIMIT 1`)
    .bind(userId)
    .first<{ team_id: string }>();
  if (existing) return existing.team_id;

  const id = `u_${userId}`.slice(0, 60);
  const now = Date.now();
  const name = email ? `${email.split("@")[0]}'s workspace` : "My workspace";
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO teams (id, name, plan, owner_id, created_at) VALUES (?,?,'free',?,?)`).bind(id, name, userId, now),
    env.DB.prepare(`INSERT OR IGNORE INTO team_members (team_id, user_id, role, created_at) VALUES (?,?, 'owner', ?)`).bind(id, userId, now),
  ]);
  return id;
}

/** Migrate pre-teams data (team_id IS NULL) owned by this user into their team.
 *  No-ops once adopted. Also moves report blobs from the old R2 path. */
export async function adoptOrphans(env: Env, teamId: string, userId: string): Promise<void> {
  const orphanProject = await env.DB.prepare(`SELECT 1 FROM projects WHERE user_id = ? AND team_id IS NULL LIMIT 1`).bind(userId).first();
  const orphanReports = await env.DB.prepare(`SELECT id FROM reports WHERE user_id = ? AND team_id IS NULL`).bind(userId).all<{ id: string }>();
  const reps = orphanReports.results ?? [];
  if (!orphanProject && reps.length === 0) return;

  if (orphanProject) {
    await env.DB.prepare(`UPDATE projects SET team_id = ? WHERE user_id = ? AND team_id IS NULL`).bind(teamId, userId).run();
  }
  if (reps.length) {
    await env.DB.prepare(`UPDATE reports SET team_id = ? WHERE user_id = ? AND team_id IS NULL`).bind(teamId, userId).run();
    // Report bodies were stored under the old user-scoped R2 path; move them.
    for (const r of reps) {
      const oldKey = `reports/${userId}/${r.id}.json`;
      const obj = await env.REPORTS.get(oldKey);
      if (obj) {
        await env.REPORTS.put(`reports/${teamId}/${r.id}.json`, await obj.arrayBuffer(), { httpMetadata: { contentType: "application/json" } });
        await env.REPORTS.delete(oldKey);
      }
    }
  }
}

/** Resolve the active team for a request (honours a requested team the user belongs to). */
export async function resolveTeam(env: Env, userId: string, email: string | null, requested?: string | null): Promise<Team> {
  const defaultId = await ensurePersonalTeam(env, userId, email);
  await adoptOrphans(env, defaultId, userId);
  let teamId = defaultId;
  if (requested) {
    const m = await env.DB.prepare(`SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?`).bind(requested, userId).first();
    if (m) teamId = requested;
  }
  return (await getTeam(env, teamId, userId))!;
}

export async function getTeam(env: Env, teamId: string, userId: string): Promise<Team | null> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.name, t.plan, t.owner_id, t.stripe_customer, m.role
       FROM teams t JOIN team_members m ON m.team_id = t.id
      WHERE t.id = ? AND m.user_id = ?`,
  )
    .bind(teamId, userId)
    .first<Record<string, string>>();
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    plan: (row.plan as Plan) ?? "free",
    role: String(row.role),
    ownerId: String(row.owner_id),
    stripeCustomer: row.stripe_customer ? String(row.stripe_customer) : null,
  };
}

export async function listTeams(env: Env, userId: string): Promise<Array<{ id: string; name: string; role: string; plan: Plan }>> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.plan, m.role FROM teams t JOIN team_members m ON m.team_id = t.id
      WHERE m.user_id = ? ORDER BY t.created_at ASC`,
  )
    .bind(userId)
    .all<Record<string, string>>();
  return (results ?? []).map((r) => ({ id: String(r.id), name: String(r.name), role: String(r.role), plan: (r.plan as Plan) ?? "free" }));
}

export async function renameTeam(env: Env, teamId: string, name: string): Promise<void> {
  await env.DB.prepare(`UPDATE teams SET name = ? WHERE id = ?`).bind(name.trim() || "Team", teamId).run();
}

export async function listMembers(env: Env, teamId: string) {
  const { results } = await env.DB.prepare(
    `SELECT m.user_id, m.role, m.created_at, u.email, u.name
       FROM team_members m LEFT JOIN user u ON u.id = m.user_id
      WHERE m.team_id = ? ORDER BY m.created_at ASC`,
  )
    .bind(teamId)
    .all<Record<string, string | number>>();
  return (results ?? []).map((r) => ({
    userId: String(r.user_id),
    role: String(r.role),
    email: r.email ? String(r.email) : null,
    name: r.name ? String(r.name) : null,
    joinedAt: Number(r.created_at),
  }));
}

export async function memberCount(env: Env, teamId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM team_members WHERE team_id = ?`).bind(teamId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export async function invite(env: Env, teamId: string, email: string, role: string): Promise<string> {
  const id = sid();
  await env.DB.prepare(`INSERT INTO team_invites (id, team_id, email, role, created_at) VALUES (?,?,?,?,?)`)
    .bind(id, teamId, email.trim().toLowerCase(), role === "admin" ? "admin" : "member", Date.now())
    .run();
  return id;
}

export async function pendingInvites(env: Env, email: string) {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.team_id, i.role, t.name FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE i.email = ?`,
  )
    .bind(email.toLowerCase())
    .all<Record<string, string>>();
  return (results ?? []).map((r) => ({ id: String(r.id), teamId: String(r.team_id), role: String(r.role), teamName: String(r.name) }));
}

export async function acceptInvite(env: Env, inviteId: string, userId: string, email: string): Promise<boolean> {
  const inv = await env.DB.prepare(`SELECT team_id, email, role FROM team_invites WHERE id = ?`).bind(inviteId).first<Record<string, string>>();
  if (!inv || String(inv.email).toLowerCase() !== email.toLowerCase()) return false;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO team_members (team_id, user_id, role, created_at) VALUES (?,?,?,?)`).bind(inv.team_id, userId, inv.role, Date.now()),
    env.DB.prepare(`DELETE FROM team_invites WHERE id = ?`).bind(inviteId),
  ]);
  return true;
}

export async function removeMember(env: Env, teamId: string, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role != 'owner'`).bind(teamId, userId).run();
}

/** Permanently delete a user + all data in teams they solely own. Teams with
 *  other members are left intact (the user's membership is removed). */
export async function deleteAccount(env: Env, userId: string): Promise<void> {
  const owned = await env.DB.prepare(`SELECT id FROM teams WHERE owner_id = ?`).bind(userId).all<{ id: string }>();
  await env.DB.prepare(`DELETE FROM api_keys WHERE user_id = ?`).bind(userId).run();
  await env.DB.prepare(`DELETE FROM team_members WHERE user_id = ?`).bind(userId).run();

  for (const t of owned.results ?? []) {
    const others = await env.DB.prepare(`SELECT COUNT(*) n FROM team_members WHERE team_id = ?`).bind(t.id).first<{ n: number }>();
    if ((others?.n ?? 0) > 0) continue; // shared team — leave it to the remaining members

    // Delete R2 report blobs for the team.
    let cursor: string | undefined;
    do {
      const listed = await env.REPORTS.list({ prefix: `reports/${t.id}/`, cursor });
      for (const o of listed.objects) await env.REPORTS.delete(o.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM reports WHERE team_id = ?`).bind(t.id),
      env.DB.prepare(`DELETE FROM projects WHERE team_id = ?`).bind(t.id),
      env.DB.prepare(`DELETE FROM rule_packs WHERE team_id = ?`).bind(t.id),
      env.DB.prepare(`DELETE FROM usage WHERE team_id = ?`).bind(t.id),
      env.DB.prepare(`DELETE FROM team_invites WHERE team_id = ?`).bind(t.id),
      env.DB.prepare(`DELETE FROM teams WHERE id = ?`).bind(t.id),
    ]);
  }

  // Better Auth identity (session/account cascade off user, but delete explicitly).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM session WHERE userId = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM account WHERE userId = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM "user" WHERE id = ?`).bind(userId),
  ]);
}

export async function setPlan(env: Env, teamId: string, plan: Plan, sub?: string | null): Promise<void> {
  await env.DB.prepare(`UPDATE teams SET plan = ?, stripe_subscription = ? WHERE id = ?`).bind(plan, sub ?? null, teamId).run();
}

export async function setStripeCustomer(env: Env, teamId: string, customer: string): Promise<void> {
  await env.DB.prepare(`UPDATE teams SET stripe_customer = ? WHERE id = ?`).bind(customer, teamId).run();
}

// --- Usage + limits ----------------------------------------------------
function period(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getUsage(env: Env, teamId: string): Promise<{ crawls: number; period: string }> {
  const p = period();
  const r = await env.DB.prepare(`SELECT crawls FROM usage WHERE team_id = ? AND period = ?`).bind(teamId, p).first<{ crawls: number }>();
  return { crawls: Number(r?.crawls ?? 0), period: p };
}

export async function incrementCrawls(env: Env, teamId: string): Promise<void> {
  const p = period();
  await env.DB.prepare(
    `INSERT INTO usage (team_id, period, crawls) VALUES (?,?,1)
       ON CONFLICT(team_id, period) DO UPDATE SET crawls = crawls + 1`,
  )
    .bind(teamId, p)
    .run();
}

export async function projectCount(env: Env, teamId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM projects WHERE team_id = ?`).bind(teamId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Reason a hosted action is blocked by the plan, or null if allowed. */
export async function crawlBlockedReason(env: Env, team: Team): Promise<string | null> {
  const plan = PLANS[team.plan];
  const { crawls } = await getUsage(env, team.id);
  if (crawls >= plan.crawlsPerMonth) {
    return `You've used all ${plan.crawlsPerMonth} crawls on the ${plan.label} plan this month. Upgrade for more.`;
  }
  return null;
}

export async function projectBlockedReason(env: Env, team: Team): Promise<string | null> {
  const plan = PLANS[team.plan];
  if ((await projectCount(env, team.id)) >= plan.projects) {
    return `The ${plan.label} plan includes ${plan.projects} project${plan.projects === 1 ? "" : "s"}. Upgrade to add more.`;
  }
  return null;
}
