// Crawlie Cloud auth Worker.
//
// Copyright (c) 2026 Spronta Ltd. Licensed under the Crawlie Enterprise Edition
// License (see ee/LICENSE) — NOT the repo's MIT license. Production use requires
// a Crawlie Enterprise subscription.
//
// Serves all of crawlie.app (and api.crawlie.app for legacy clients):
//   /api/auth/*   → Better Auth (sessions, GitHub OAuth, email OTP, device grant)
//   /v1/*         → hosted crawler API (auth-gated)
//   /device       → device-approval page for `crawlie login` (CLI/desktop)
//   everything else → the dashboard SPA (static assets, in-app sign-in)

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { trustedOrigins } from "./env";
import { createAuth } from "./auth";
import { devicePage, errorPage } from "./pages";
import { v1 } from "./v1";

const app = new Hono<{ Bindings: Env }>();

// Cross-origin, credentialed access for non-hosted clients (desktop app, any
// JS on crawlie.dev). The hosted pages are same-origin and unaffected.
app.use("/api/auth/*", async (c, next) => {
  const allowed = trustedOrigins(c.env);
  return cors({
    origin: (origin) => (origin && allowed.includes(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    maxAge: 600,
  })(c, next);
});

// Branded error screen — override Better Auth's default `/api/auth/error`
// page. Registered before the catch-all so it wins for this exact route.
app.get("/api/auth/error", (c) =>
  c.html(errorPage(c.env, c.req.query("error") ?? "")),
);

// Hand every Better Auth route to the per-request auth instance.
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// Hosted crawler API (auth-gated inside).
app.route("/v1", v1);

// Public, unauthenticated: a shared report by token (powers crawlie.app/p/…).
app.get("/pub/reports/:token", async (c) => {
  const { loadPublicReport } = await import("./reports");
  const report = await loadPublicReport(c.env, c.req.param("token"));
  return report ? c.json(report) : c.json({ error: "not found" }, 404);
});

// Device verification / approval page for `crawlie login`.
app.get("/device", (c) => {
  const userCode = c.req.query("user_code") ?? "";
  return c.html(devicePage(c.env, userCode));
});

app.get("/health", (c) => c.json({ ok: true, service: "crawlie-cloud" }));

// Anything else the Worker sees falls back to the dashboard SPA.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Durable Object backing the hosted-crawl container.
export { CrawlerContainer } from "./containers";

// fetch = the Hono app; scheduled = the cron monitoring engine.
import { scheduled } from "./scheduled";
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled,
} satisfies ExportedHandler<Env>;
