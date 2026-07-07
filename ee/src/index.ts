// Crawlie Cloud auth Worker.
//
// Copyright (c) 2026 Spronta Ltd. Licensed under the Crawlie Enterprise Edition
// License (see ee/LICENSE) — NOT the repo's MIT license. Production use requires
// a Crawlie Enterprise subscription.
//
// Owns two surfaces on api.crawlie.app:
//   /api/auth/*   → Better Auth (sessions, GitHub OAuth, email OTP, device grant)
//   /  and /device → the hosted sign-in / device-approval pages
//
// Everything else (CLI, MCP, desktop, marketing site) is a client of this.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { trustedOrigins } from "./env";
import { createAuth } from "./auth";
import { devicePage, webSignInPage } from "./pages";

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

// Hand every Better Auth route to the per-request auth instance.
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// Hosted sign-in (web signups land here).
app.get("/", (c) => c.html(webSignInPage(c.env)));

// Device verification / approval page for `crawlie login`.
app.get("/device", (c) => {
  const userCode = c.req.query("user_code") ?? "";
  return c.html(devicePage(c.env, userCode));
});

app.get("/health", (c) => c.json({ ok: true, service: "crawlie-auth" }));

export default app;
