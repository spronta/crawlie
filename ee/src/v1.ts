// Hosted crawler API (crawlie.app/v1/*). Auth-gated (session or API key) and
// TEAM-scoped: every request resolves the active team; projects/reports belong
// to it; the plan gates limits; Stripe drives upgrades.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { runCrawl, cancelCrawl, previewPack } from "./crawler";
import {
  listReports,
  loadReport,
  deleteReport,
  saveReport,
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
  recordCrawl,
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
  incrementCrawls,
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

// Stream a crawl as SSE; meter usage; persist against the team (+ project).
function crawlStream(c: Ctx, config: unknown, projectId: string | null) {
  const team = c.get("team");
  const userId = c.get("userId");
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const packs = await enabledPackSources(c.env, team.id);
        const result = await runCrawl(c.env, config, (ev) => send(ev), packs);
        const health = (result as { summary?: { healthScore?: number } }).summary?.healthScore ?? 0;
        const reportId = await saveReport(c.env, team.id, userId, result as Parameters<typeof saveReport>[3], projectId);
        await incrementCrawls(c.env, team.id);
        if (projectId) await recordCrawl(c.env, team.id, projectId, reportId, health, Date.now());
        await send({ type: "result", result });
      } catch (err) {
        await send({ type: "error", message: String(err) });
      } finally {
        await writer.close();
      }
    })(),
  );
  return new Response(readable, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

// --- Crawls (metered) --------------------------------------------------
v1.post("/crawls", async (c) => {
  const blocked = await crawlBlockedReason(c.env, c.get("team"));
  if (blocked) return c.json({ error: blocked, code: "plan_limit" }, 402);
  const body = await c.req.json<{ config: unknown }>().catch(() => null);
  if (!body?.config) return c.json({ error: "missing config" }, 400);
  return crawlStream(c, body.config, null);
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
  return crawlStream(c, { url: p.url, ...(p.config ?? {}) }, p.id);
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
