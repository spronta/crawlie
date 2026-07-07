// Hosted crawler API (crawlie.app/v1/*). Auth-gated: every route requires a
// valid Crawlie Cloud session. Crawls run in a Cloudflare Container (see the
// CRAWLER Durable Object); reports are stored in D1 (metadata) + R2 (full JSON).

import { Hono } from "hono";
import type { Env } from "./env";
import { createAuth } from "./auth";
import { runCrawl, cancelCrawl } from "./crawler";
import {
  listReports,
  loadReport,
  deleteReport,
  saveReport,
  diffReports,
} from "./reports";

type Vars = { userId: string };

export const v1 = new Hono<{ Bindings: Env; Variables: Vars }>();

// Require a session on every /v1 route; expose the user id to handlers.
v1.use("*", async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.user.id);
  await next();
});

// --- Crawls -------------------------------------------------------------
// Start a crawl and stream progress as Server-Sent Events, ending with a
// `result` event. The finished report is persisted for the user.
v1.post("/crawls", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ config: unknown }>().catch(() => null);
  if (!body?.config) return c.json({ error: "missing config" }, 400);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result = await runCrawl(c.env, body.config, (ev) => send(ev));
        await saveReport(c.env, userId, result as Parameters<typeof saveReport>[2]);
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
});

v1.post("/crawls/:id/cancel", async (c) => {
  await cancelCrawl(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// --- Reports ------------------------------------------------------------
v1.get("/reports", async (c) => c.json(await listReports(c.env, c.get("userId"))));

v1.get("/reports/:id", async (c) => {
  const report = await loadReport(c.env, c.get("userId"), c.req.param("id"));
  return report ? c.json(report) : c.json({ error: "not found" }, 404);
});

v1.delete("/reports/:id", async (c) => {
  await deleteReport(c.env, c.get("userId"), c.req.param("id"));
  return c.json({ ok: true });
});

v1.get("/diff", async (c) => {
  const oldId = c.req.query("old");
  const newId = c.req.query("new");
  if (!oldId || !newId) return c.json({ error: "old and new required" }, 400);
  const diff = await diffReports(c.env, c.get("userId"), oldId, newId);
  return diff ? c.json(diff) : c.json({ error: "not found" }, 404);
});
