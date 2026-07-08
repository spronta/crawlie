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

// Stripe webhook: sync plan changes onto the team. Signature-verified.
app.post("/pub/stripe/webhook", async (c) => {
  const { verifyWebhook } = await import("./stripe");
  const { setPlan, setStripeCustomer } = await import("./teams");
  const payload = await c.req.text();
  const event = await verifyWebhook(c.env, payload, c.req.header("stripe-signature") ?? null);
  if (!event) return c.json({ error: "invalid signature" }, 400);
  const obj = (event.data as { object?: Record<string, unknown> })?.object ?? {};
  const teamId = ((obj.metadata as Record<string, string>) ?? {}).teamId;
  const type = String(event.type);
  try {
    if (type === "checkout.session.completed" && teamId) {
      if (obj.customer) await setStripeCustomer(c.env, teamId, String(obj.customer));
      // Plan is finalized by the subsequent subscription.updated event.
    } else if ((type === "customer.subscription.updated" || type === "customer.subscription.created") && teamId) {
      const active = obj.status === "active" || obj.status === "trialing";
      const priceId = (((obj.items as { data?: Array<{ price?: { id?: string } }> })?.data ?? [])[0]?.price?.id) ?? "";
      let plan: "free" | "pro" | "business" = "free";
      if (active && priceId === c.env.STRIPE_PRICE_BUSINESS) plan = "business";
      else if (active && priceId === c.env.STRIPE_PRICE_PRO) plan = "pro";
      await setPlan(c.env, teamId, plan, String(obj.id ?? ""));
    } else if (type === "customer.subscription.deleted" && teamId) {
      await setPlan(c.env, teamId, "free", null);
    }
  } catch (e) {
    console.error("stripe webhook:", e);
  }
  return c.json({ received: true });
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
