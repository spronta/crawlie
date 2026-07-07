// Better Auth instance factory.
//
// On Cloudflare Workers the D1 binding only exists per-request (via `env`), so
// the auth instance is built per-request rather than at module load. `createAuth`
// is cheap; Better Auth does no I/O until a handler runs.

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./env";
import { sendOtpEmail, subscribeToNewsletter } from "./loops";
import { trustedOrigins } from "./env";

export function buildAuthOptions(env: Env): BetterAuthOptions {
  return {
    appName: "Crawlie",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: {
      dialect: new D1Dialect({ database: env.DB }),
      type: "sqlite",
    },
    trustedOrigins: trustedOrigins(env),
    // Password auth is intentionally off — GitHub OAuth + email code only.
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    // Subscribe brand-new accounts to the Crawlie newsletter (opt-out via
    // LOOPS_NEWSLETTER_ON_SIGNUP=false). Best-effort: never block signup on a
    // Loops hiccup.
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await subscribeToNewsletter(env, user.email, user.name);
            } catch {
              /* newsletter is non-critical; swallow */
            }
          },
        },
      },
    },
    plugins: [
      // Email one-time code — delivered through Loops (doubles as the newsletter
      // provider so the whole email relationship lives in one place).
      emailOTP({
        otpLength: 6,
        expiresIn: 600, // 10 minutes
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtpEmail(env, email, otp, type);
        },
      }),
      // OAuth 2.0 device grant (RFC 8628) for the CLI, MCP and desktop app.
      deviceAuthorization({
        // Full URL so the CLI can print/open it directly.
        verificationUri: `${env.BETTER_AUTH_URL}/device`,
        expiresIn: "30m",
        interval: "5s",
      }),
      // Accept `Authorization: Bearer <session-token>` so non-browser clients
      // (CLI/MCP/desktop) can call the API without cookies.
      bearer(),
    ],
  };
}

export function createAuth(env: Env) {
  return betterAuth(buildAuthOptions(env));
}

export type Auth = ReturnType<typeof createAuth>;
