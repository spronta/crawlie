// Hosted crawler API (crawlie.app/v1/*). Auth-gated: every route requires a
// valid Crawlie Cloud session. Crawls run in a Cloudflare Container; reports go
// to D1 (metadata) + R2 (full JSON). Projects add saved sites, history, trends
// and scheduled monitoring.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { runCrawl, cancelCrawl } from "./crawler";
import { listReports, loadReport, deleteReport, saveReport, diffReports } from "./reports";
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

type Vars = { userId: string };

export const v1 = new Hono<{ Bindings: Env; Variables: Vars }>();

// Require auth on every /v1 route: a browser session OR an account API key
// (Authorization: Bearer crw_…), so the CLI/MCP/CI can drive hosted crawls.
v1.use("*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer crw_")) {
    const uid = await userIdForKey(c.env, auth.slice(7));
    if (uid) {
      c.set("userId", uid);
      return next();
    }
  }
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
});

// Stream a crawl as SSE, persisting the report (optionally against a project).
function crawlStream(
  c: Context<{ Bindings: Env; Variables: Vars }>,
  config: unknown,
  projectId: string | null,
) {
  const userId = c.get("userId");
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result = await runCrawl(c.env, config, (ev) => send(ev));
        const health =
          (result as { summary?: { healthScore?: number } }).summary?.healthScore ?? 0;
        const reportId = await saveReport(
          c.env,
          userId,
          result as Parameters<typeof saveReport>[2],
          projectId,
        );
        if (projectId) await recordCrawl(c.env, userId, projectId, reportId, health, Date.now());
        await send({ type: "result", result });
      } catch (err) {
        await send({ type: "error", message: String(err) });
      } finally {
        await writer.close();
      }
    })(),
  );

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

// --- Ad-hoc crawls -----------------------------------------------------
v1.post("/crawls", async (c) => {
  const body = await c.req.json<{ config: unknown }>().catch(() => null);
  if (!body?.config) return c.json({ error: "missing config" }, 400);
  return crawlStream(c, body.config, null);
});

v1.post("/crawls/:id/cancel", async (c) => {
  await cancelCrawl(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// --- Projects ----------------------------------------------------------
v1.get("/projects", async (c) => c.json(await listProjects(c.env, c.get("userId"))));

v1.post("/projects", async (c) => {
  const body = await c.req
    .json<{ url?: string; name?: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> }>()
    .catch(() => null);
  if (!body?.url) return c.json({ error: "url required" }, 400);
  const project = await createProject(c.env, c.get("userId"), { ...body, url: body.url }, Date.now());
  return c.json(project, 201);
});

v1.get("/projects/:id", async (c) => {
  const p = await getProject(c.env, c.get("userId"), c.req.param("id"));
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});

v1.patch("/projects/:id", async (c) => {
  const body = await c.req
    .json<{ name?: string; schedule?: Schedule; notify?: boolean; config?: Record<string, unknown> | null }>()
    .catch(() => ({}));
  const p = await updateProject(c.env, c.get("userId"), c.req.param("id"), body, Date.now());
  return p ? c.json(p) : c.json({ error: "not found" }, 404);
});

v1.delete("/projects/:id", async (c) => {
  await deleteProject(c.env, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

// Run a crawl for a project (streams SSE, records history + schedule).
v1.post("/projects/:id/crawls", async (c) => {
  const p = await getProject(c.env, c.get("userId"), c.req.param("id"));
  if (!p) return c.json({ error: "not found" }, 404);
  const config = { url: p.url, ...(p.config ?? {}) };
  return crawlStream(c, config, p.id);
});

v1.get("/projects/:id/reports", async (c) =>
  c.json(await listReports(c.env, c.get("userId"), c.req.param("id"))),
);

v1.get("/projects/:id/trend", async (c) =>
  c.json(await projectTrend(c.env, c.get("userId"), c.req.param("id"))),
);

// --- Reports -----------------------------------------------------------
v1.get("/reports", async (c) => c.json(await listReports(c.env, c.get("userId"))));

v1.get("/reports/:id", async (c) => {
  const report = await loadReport(c.env, c.get("userId"), c.req.param("id"));
  return report ? c.json(report) : c.json({ error: "not found" }, 404);
});

v1.delete("/reports/:id", async (c) => {
  await deleteReport(c.env, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

// --- API keys ----------------------------------------------------------
v1.get("/keys", async (c) => c.json(await listKeys(c.env, c.get("userId"))));

v1.post("/keys", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const { key, meta } = await createKey(c.env, c.get("userId"), body.name ?? "API key");
  return c.json({ key, ...meta }, 201); // `key` shown once
});

v1.delete("/keys/:id", async (c) => {
  await revokeKey(c.env, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

v1.get("/diff", async (c) => {
  const oldId = c.req.query("old");
  const newId = c.req.query("new");
  if (!oldId || !newId) return c.json({ error: "old and new required" }, 400);
  const diff = await diffReports(c.env, c.get("userId"), oldId, newId);
  return diff ? c.json(diff) : c.json({ error: "not found" }, 404);
});
