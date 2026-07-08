// Stripe billing via the REST API (no SDK — Workers-friendly). Checkout to
// upgrade, billing portal to manage, and a signed webhook to sync plan changes.
// Everything degrades gracefully until STRIPE_SECRET_KEY is set.

import type { Env } from "./env";

const API = "https://api.stripe.com/v1";

export function stripeConfigured(env: Env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

function encode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function post<T>(env: Env, path: string, params: Record<string, string>): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: encode(params),
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

export async function createCheckout(
  env: Env,
  opts: { priceId: string; teamId: string; email: string; customer: string | null; successUrl: string; cancelUrl: string },
): Promise<string | null> {
  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "metadata[teamId]": opts.teamId,
    "subscription_data[metadata][teamId]": opts.teamId,
    allow_promotion_codes: "true",
  };
  if (opts.customer) params.customer = opts.customer;
  else if (opts.email) params.customer_email = opts.email;
  const session = await post<{ url?: string }>(env, "/checkout/sessions", params);
  return session?.url ?? null;
}

export async function createPortal(env: Env, customer: string, returnUrl: string): Promise<string | null> {
  const session = await post<{ url?: string }>(env, "/billing_portal/sessions", { customer, return_url: returnUrl });
  return session?.url ?? null;
}

// --- Webhook signature verification (Stripe scheme: t=…,v1=…) ----------
async function hmacHex(secret: string, data: string): Promise<string> {
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", keyMat, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyWebhook(env: Env, payload: string, sigHeader: string | null): Promise<Record<string, unknown> | null> {
  if (!env.STRIPE_WEBHOOK_SECRET || !sigHeader) return null;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return null;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  if (expected !== v1) return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}
