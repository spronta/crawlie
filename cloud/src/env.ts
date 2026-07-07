/** Cloudflare bindings + vars available to the Worker (see wrangler.jsonc). */
export interface Env {
  /** D1 database bound as `DB`. */
  DB: D1Database;

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
}

/** Origins permitted to call the auth API with credentials. */
export function trustedOrigins(env: Env): string[] {
  return (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
