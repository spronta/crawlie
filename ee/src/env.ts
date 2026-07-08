import type { CrawlerContainer } from "./containers";

/** Cloudflare bindings + vars available to the Worker (see wrangler.jsonc). */
export interface Env {
  /** D1 database bound as `DB`. */
  DB: D1Database;

  /** Static assets for the dashboard SPA (see wrangler.jsonc `assets`). */
  ASSETS: Fetcher;

  /** R2 bucket holding full CrawlResult JSON for hosted reports. */
  REPORTS: R2Bucket;

  /** Durable Object namespace for the crawler container. */
  CRAWLER: DurableObjectNamespace<CrawlerContainer>;

  // --- Secrets (wrangler secret put ...) ---
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  LOOPS_API_KEY?: string;

  // --- Vars (wrangler.jsonc `vars`) ---
  BETTER_AUTH_URL: string;
  TRUSTED_ORIGINS?: string;
  LOOPS_NEWSLETTER_MAILING_LIST_ID?: string;
  LOOPS_OTP_TRANSACTIONAL_ID?: string;
  LOOPS_NEWSLETTER_ON_SIGNUP?: string;
  /** Loops transactional template for scheduled-crawl regression alerts. */
  LOOPS_ALERT_TRANSACTIONAL_ID?: string;
}

/** Origins permitted to call the auth API with credentials. */
export function trustedOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
