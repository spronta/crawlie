// Hosted crawler API (crawlie.app/v1/*). Auth-gated (session or API key) and
// TEAM-scoped: every request resolves the active team; projects/reports belong
// to it; the plan gates limits; Stripe drives upgrades.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { startJob, armWatch, watchState, cancelCrawl, previewPack, registerActiveCrawl, listActiveCrawls } from "./crawler";
import {
  listReports,
  loadReport,
  reportPart,
  readPartJson,
  deleteReport,
  diffReports,
  shareReport,
  unshareReport,
  reportShareToken,
  projectHistory,
} from "./reports";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  projectTrend,
  type Schedule,
} from "./projects";
import { createKey, listKeys, revokeKey, userIdForKey } from "./keys";
import { listPacks, getPack, createPack, updatePack, deletePack, enabledPackSources } from "./packs";
import { userEmail } from "./alerts";
import {
  resolveTeam,
  getTeam,
  listTeams,
  renameTeam,
  listMembers,
  memberCount,
  invite,
  pendingInvites,
  acceptInvite,
  removeMember,
  getUsage,
  crawlBlockedReason,
  projectBlockedReason,
  deleteAccount,
  PLANS,
  type Team,
  type Plan,
} from "./teams";
import { stripeConfigured, createCheckout, createPortal } from "./stripe";

type Vars = { userId: string; email: string; team: Team };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

export const v1 = new Hono<{ Bindings: Env; Variables: Vars }>();

// Resolve the user (session or API key) + their active team on every route.
v1.use("*", async (c, next) => {
  let userId = "";
  let email = "";
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer crw_")) {
    const uid = await userIdForKey(c.env, auth.slice(7));
    if (uid) {
      userId = uid;
      email = (await userEmail(c.env, uid)) ?? "";
    }
  }
  if (!userId) {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "unauthorized" }, 401);
    userId = session.user.id;
    email = session.user.email;
  }
  const team = await resolveTeam(c.env, userId, email, c.req.header("x-crawlie-team"));
  c.set("userId", userId);
  c.set("email", email);
  c.set("team", team);
  await next();
});

/** Fetch concurrency scaled to crawl size (unless the user pinned one): big
 *  crawls get more in-flight requests; small ones stay polite by default. */
function concurrencyFor(maxPages: number): number {
  if (maxPages >= 50_000) return 48;
  if (maxPages >= 5_000) return 32;
  return 16;
}

// Start a crawl as a background job in the container (decoupled from this
// request), returning a jobId the client polls. Bounds pages to the plan cap.
// The Durable Object watcher — armed here — owns the crawl from this moment:
// it keeps the container awake, saves the report to R2/D1 when the crawl
// finishes, and meters usage exactly once, whether or not any browser polls.
async function startCrawlJob(
  c: Ctx,
  config: Record<string, unknown>,
  projectId: string | null,
  scheduled?: import("./containers").WatchInfo["scheduled"],
) {
  const team = c.get("team");
  const cap = PLANS[team.plan].maxPages;
  const requested = typeof config.maxPages === "number" && config.maxPages > 0 ? config.maxPages : cap;
  const maxPages = Math.min(requested, cap);
  const concurrency =
    typeof config.concurrency === "number" && config.concurrency > 0
      ? Math.min(config.concurrency, 64)
      : concurrencyFor(maxPages);
  const jobId = crypto.randomUUID();
  const packs = await enabledPackSources(c.env, team.id);
  await startJob(c.env, jobId, { ...config, maxPages, concurrency }, packs);
  await armWatch(c.env, { jobId, teamId: team.id, userId: c.get("userId"), projectId, scheduled });
  // Best-effort: the reattach registry must never block a crawl from starting.
  try {
    await registerActiveCrawl(c.env, { jobId, teamId: team.id, projectId, url: String(config.url ?? ""), maxPages, startedAt: Date.now() });
  } catch (err) {
    console.error("active-crawl register failed:", err);
  }
  return c.json({ jobId, maxPages, capped: requested > maxPages, projectId });
}

// --- Crawls (metered) --------------------------------------------------
v1.post("/crawls", async (c) => {
  const blocked = await crawlBlockedReason(c.env, c.get("team"));
  if (blocked) return c.json({ error: blocked, code: "plan_limit" }, 402);
  const body = await c.req.json<{ config: Record<string, unknown> }>().catch(() => null);
  if (!body?.config) return c.json({ error: "missing config" }, 400);
  return startCrawlJob(c, body.config, null);
});

// The team's currently running crawls — lets a freshly loaded dashboard
// reattach to jobs it lost track of (reload, other device).
v1.get("/crawls", async (c) => {
  const rows = await listActiveCrawls(c.env, c.get("team").id);
  return c.json(rows.map((r) => ({ jobId: r.jobId, projectId: r.projectId, url: r.url, maxPages: r.maxPages, startedAt: r.startedAt })));
});

// Poll a running crawl job. The DO watcher owns saving/metering; this route
// just reflects its state (running progress → saving → done + reportId).
v1.get("/crawls/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  let st;
  try {
    st = await watchState(c.env, jobId);
  } catch {
    return c.json({ status: "error", message: "Lost contact with the crawler. Please try again." });
  }
  // Unknown job (container recycled before the watcher was armed) — treat as
  // a soft failure so the client can offer a retry rather than spin forever.
  if (st.status === "unknown") {
    return c.json({ status: "error", message: "The crawl is no longer available. Please run it again." });
  }
  return c.json(st);
});

v1.post("/crawls/:id/cancel", async (c) => {
  await cancelCrawl(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// --- Projects ----------------------------------------------------------
v1.get("/projects", async (c) => c.json(await listProjects(c.env, c.get("team").id)));

v1.post("/projects", async (c) => {
  const team = c.get("team");
  const blocked = await projectBlockedReason(c.env, team);
  if (blocked) return c.json({ error: blocked, code: "plan_limit" }, 402);
  const body = await c.req.json<{ url?: string; name?: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> }>().catch(() => null);
  if (!body?.url) return c.json({ error: "url required" }, 400);
  // Scheduling is a paid feature.
  const schedule = PLANS[team.plan].scheduling ? body.schedule : "off";
  const project = await createProject(c.env, team.id, c.get("userId"), { ...body, url: body.url, schedule }, Date.now());
  return c.json(project, 201);
});

v1.get("/projects/:id", async (c) => {
  const p = await getProject(c.env, c.get("team").id, c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});

v1.patch("/projects/:id", async (c) => {
  const team = c.get("team");
  const body = await c.req.json<{ name?: string; schedule?: Schedule; notify?: boolean; notifyWebhook?: string | null; config?: Record<string, unknown> | null }>().catch(() => ({}) as { name?: string; schedule?: Schedule; notify?: boolean; notifyWebhook?: string | null; config?: Record<string, unknown> | null });
  if (body.schedule && body.schedule !== "off" && !PLANS[team.plan].scheduling) {
    return c.json({ error: "Scheduled crawls are a paid feature.", code: "plan_limit" }, 402);
  }
  const p = await updateProject(c.env, team.id, c.req.param("id"), body, Date.now());
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});

v1.delete("/projects/:id", async (c) => {
  await deleteProject(c.env, c.get("team").id, c.req.param("id"));
  return c.json({ ok: true });
});

v1.post("/projects/:id/crawls", async (c) => {
  const blocked = await crawlBlockedReason(c.env, c.get("team"));
  if (blocked) return c.json({ error: blocked, code: "plan_limit" }, 402);
  const p = await getProject(c.env, c.get("team").id, c.req.param("id"));
  if (!p) return c.json({ error: "not found" }, 404);
  return startCrawlJob(c, { url: p.url, ...(p.config ?? {}) }, p.id);
});

v1.get("/projects/:id/reports", async (c) => {
  const p = await getProject(c.env, c.get("team").id, c.req.param("id"));
  if (!p) return c.json([]);
  return c.json(await projectHistory(c.env, c.get("team").id, p.id, p.url));
});
v1.get("/projects/:id/trend", async (c) => c.json(await projectTrend(c.env, c.get("team").id, c.req.param("id"))));

// --- Reports -----------------------------------------------------------
v1.get("/reports", async (c) => c.json(await listReports(c.env, c.get("team").id)));
v1.get("/reports/:id", async (c) => {
  const report = await loadReport(c.env, c.get("team").id, c.req.param("id"));
  return report ? c.json(report) : c.json({ error: "not found" }, 404);
});
v1.delete("/reports/:id", async (c) => {
  await deleteReport(c.env, c.get("team").id, c.req.param("id"));
  return c.json({ ok: true });
});
// Report bundle parts for big (lean) reports: the compact page index and the
// full-page chunks, streamed straight from R2.
v1.get("/reports/:id/index", async (c) => {
  const res = await reportPart(c.env, c.get("team").id, c.req.param("id"), "index.json");
  return res ?? c.json({ error: "not found" }, 404);
});
v1.get("/reports/:id/pages/:n", async (c) => {
  const n = Number.parseInt(c.req.param("n"), 10);
  if (!Number.isInteger(n) || n < 0) return c.json({ error: "bad chunk" }, 400);
  const res = await reportPart(c.env, c.get("team").id, c.req.param("id"), `pages/${n}.json`);
  return res ?? c.json({ error: "not found" }, 404);
});
v1.get("/reports/:id/share", async (c) => c.json({ token: await reportShareToken(c.env, c.get("team").id, c.req.param("id")) }));
v1.post("/reports/:id/share", async (c) => {
  const token = await shareReport(c.env, c.get("team").id, c.req.param("id"));
  return token ? c.json({ token, url: `https://crawlie.app/p/${token}` }) : c.json({ error: "not found" }, 404);
});
v1.delete("/reports/:id/share", async (c) => {
  await unshareReport(c.env, c.get("team").id, c.req.param("id"));
  return c.json({ ok: true });
});
v1.get("/diff", async (c) => {
  const oldId = c.req.query("old");
  const newId = c.req.query("new");
  if (!oldId || !newId) return c.json({ error: "old and new required" }, 400);
  const diff = await diffReports(c.env, c.get("team").id, oldId, newId);
  return diff ? c.json(diff) : c.json({ error: "not found" }, 404);
});

// --- Team --------------------------------------------------------------
v1.get("/team", async (c) => {
  const team = c.get("team");
  const [usage, members] = await Promise.all([getUsage(c.env, team.id), listMembers(c.env, team.id)]);
  return c.json({ team, plan: PLANS[team.plan], usage, members, plans: PLANS, billingEnabled: stripeConfigured(c.env) });
});

v1.get("/teams", async (c) => c.json(await listTeams(c.env, c.get("userId"))));

v1.patch("/team", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  if (body.name) await renameTeam(c.env, c.get("team").id, body.name);
  return c.json(await getTeam(c.env, c.get("team").id, c.get("userId")));
});

v1.post("/team/invite", async (c) => {
  const team = c.get("team");
  if (team.role === "member") return c.json({ error: "admins only" }, 403);
  if ((await memberCount(c.env, team.id)) >= PLANS[team.plan].seats) {
    return c.json({ error: `The ${PLANS[team.plan].label} plan includes ${PLANS[team.plan].seats} seat(s). Upgrade to invite more.`, code: "plan_limit" }, 402);
  }
  const body = await c.req.json<{ email?: string; role?: string }>().catch(() => ({}) as { email?: string; role?: string });
  if (!body.email) return c.json({ error: "email required" }, 400);
  const id = await invite(c.env, team.id, body.email, body.role ?? "member");
  return c.json({ id, ok: true }, 201);
});

v1.delete("/team/members/:userId", async (c) => {
  if (c.get("team").role === "member") return c.json({ error: "admins only" }, 403);
  await removeMember(c.env, c.get("team").id, c.req.param("userId"));
  return c.json({ ok: true });
});

v1.delete("/account", async (c) => {
  await deleteAccount(c.env, c.get("userId"));
  return c.json({ ok: true });
});

v1.get("/invites", async (c) => c.json(await pendingInvites(c.env, c.get("email"))));
v1.post("/invites/:id/accept", async (c) => {
  const ok = await acceptInvite(c.env, c.req.param("id"), c.get("userId"), c.get("email"));
  return c.json({ ok });
});

// --- Rule packs (marketing monitoring + custom audit checks) ------------
/** check_rule audit packs are a Pro feature; content rules stay on every plan. */
function customRulesBlocked(c: Ctx, source: string | undefined): boolean {
  return !!source && source.includes("check_rule") && !PLANS[c.get("team").plan].customRules;
}

v1.get("/packs", async (c) => c.json(await listPacks(c.env, c.get("team").id)));
v1.post("/packs", async (c) => {
  const body = await c.req.json<{ name?: string; source?: string; enabled?: boolean }>().catch(() => ({}) as { name?: string; source?: string; enabled?: boolean });
  if (!body.source) return c.json({ error: "source required" }, 400);
  if (customRulesBlocked(c, body.source)) return c.json({ error: "Custom audit rules (check_rule) are a Pro feature.", code: "plan" }, 402);
  return c.json(await createPack(c.env, c.get("team").id, { name: body.name ?? "New pack", source: body.source, enabled: body.enabled }), 201);
});
// Validate a pack and dry-run its checks against a saved report (rule builder).
v1.post("/packs/preview", async (c) => {
  const body = await c.req.json<{ source?: string; reportId?: string }>().catch(() => ({}) as { source?: string; reportId?: string });
  if (!body.source) return c.json({ error: "source required" }, 400);
  let pages: unknown[] = [];
  if (body.reportId) {
    const report = await loadReport(c.env, c.get("team").id, body.reportId);
    pages = ((report as { pages?: unknown[] } | null)?.pages ?? []).slice(0, 300);
    // Lean (big) reports store pages as chunks — sample the first two.
    if (pages.length === 0) {
      for (const n of [0, 1]) {
        const chunk = await readPartJson<unknown[]>(c.env, c.get("team").id, body.reportId, `pages/${n}.json`);
        if (!chunk) break;
        pages = pages.concat(chunk);
      }
      pages = pages.slice(0, 300);
    }
  }
  try {
    return c.json(await previewPack(c.env, body.source, pages));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
v1.get("/packs/:id", async (c) => {
  const p = await getPack(c.env, c.get("team").id, c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});
v1.patch("/packs/:id", async (c) => {
  const body = await c.req.json<{ name?: string; source?: string; enabled?: boolean }>().catch(() => ({}) as { name?: string; source?: string; enabled?: boolean });
  if (customRulesBlocked(c, body.source)) return c.json({ error: "Custom audit rules (check_rule) are a Pro feature.", code: "plan" }, 402);
  const p = await updatePack(c.env, c.get("team").id, c.req.param("id"), body);
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});
v1.delete("/packs/:id", async (c) => {
  await deletePack(c.env, c.get("team").id, c.req.param("id"));
  return c.json({ ok: true });
});

// --- API keys ----------------------------------------------------------
v1.get("/keys", async (c) => c.json(await listKeys(c.env, c.get("userId"))));
v1.post("/keys", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const { key, meta } = await createKey(c.env, c.get("userId"), body.name ?? "API key");
  return c.json({ key, ...meta }, 201);
});
v1.delete("/keys/:id", async (c) => {
  await revokeKey(c.env, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

// --- Billing -----------------------------------------------------------
v1.post("/billing/checkout", async (c) => {
  const team = c.get("team");
  if (team.role !== "owner") return c.json({ error: "only the owner can change the plan" }, 403);
  if (!stripeConfigured(c.env)) return c.json({ error: "billing not configured" }, 503);
  const body = await c.req.json<{ plan?: Plan }>().catch(() => ({}) as { plan?: Plan });
  const def = body.plan ? PLANS[body.plan] : undefined;
  if (!def?.stripePriceVar) return c.json({ error: "invalid plan" }, 400);
  const priceId = c.env[def.stripePriceVar];
  if (!priceId) return c.json({ error: "plan price not configured" }, 503);
  const url = await createCheckout(c.env, {
    priceId,
    teamId: team.id,
    email: c.get("email"),
    customer: team.stripeCustomer,
    successUrl: "https://crawlie.app/?upgraded=1",
    cancelUrl: "https://crawlie.app/",
  });
  return url ? c.json({ url }) : c.json({ error: "checkout failed" }, 502);
});

v1.post("/billing/portal", async (c) => {
  const team = c.get("team");
  if (team.role !== "owner") return c.json({ error: "only the owner can manage billing" }, 403);
  if (!team.stripeCustomer) return c.json({ error: "no subscription" }, 400);
  const url = await createPortal(c.env, team.stripeCustomer, "https://crawlie.app/");
  return url ? c.json({ url }) : c.json({ error: "portal failed" }, 502);
});
