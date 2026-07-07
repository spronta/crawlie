# Crawlie Cloud — auth service

> **License:** commercial. Everything in this `ee/` directory is licensed under
> the Crawlie Enterprise Edition License ([`./LICENSE`](./LICENSE)) — **not** the
> MIT license that covers the rest of the repo. You may read and modify it for
> development and testing, but running it in production or offering it as a
> service requires a Crawlie Enterprise subscription. The CLI, MCP and desktop
> *clients* that talk to this service stay MIT.

The account layer for Crawlie Cloud. One identity shared by the **web**, the
**CLI** (`crawlie login`), the **MCP server**, and the **desktop app**.

- **Runtime:** Cloudflare Worker (Hono) — deploys to `api.crawlie.dev`
- **Auth:** [Better Auth](https://better-auth.com) with **GitHub OAuth** + **email one-time code**
- **Store:** Cloudflare **D1** (SQLite)
- **Email + newsletter:** [Loops](https://loops.so) — sends the sign-in code *and* subscribes new signups to the Crawlie newsletter
- **Non-browser clients:** OAuth 2.0 **Device Authorization Grant** (RFC 8628) + bearer tokens

The marketing site (`apps/website`) stays on Vercel and simply links here; this
Worker is the only thing that holds sessions.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | Hosted web sign-in (marketing "Get started" lands here) |
| `GET /device?user_code=…` | Device approval page for `crawlie login` |
| `POST /api/auth/device/code` | CLI/MCP/desktop request a device + user code |
| `POST /api/auth/device/token` | CLI/MCP/desktop poll for the session token |
| `/api/auth/*` | Full Better Auth surface (GitHub, email OTP, sessions) |
| `GET /health` | Liveness check |

## One-time setup

```bash
cd ee
pnpm install

# 1. Create the D1 database, then paste its id into wrangler.jsonc (database_id).
npx wrangler d1 create crawlie-auth

# 2. Apply the schema.
pnpm db:migrate:local     # local dev
pnpm db:migrate:remote    # production

# 3. Secrets (production).
npx wrangler secret put BETTER_AUTH_SECRET      # openssl rand -base64 32
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put LOOPS_API_KEY

# 4. Non-secret Loops ids in wrangler.jsonc `vars`:
#    LOOPS_NEWSLETTER_MAILING_LIST_ID  — the Crawlie newsletter list
#    LOOPS_OTP_TRANSACTIONAL_ID        — a transactional template using {{otp}}
```

**GitHub OAuth app** → callback URL `https://api.crawlie.dev/api/auth/callback/github`.

## Local dev

```bash
cp .dev.vars.example .dev.vars   # fill in a dev secret + GitHub dev app
pnpm db:migrate:local
pnpm dev                          # http://localhost:8787
```

## Schema

`migrations/0001_better_auth.sql` mirrors `better-auth` core (user / session /
account / verification) plus the device-authorization plugin's `deviceCode`
table, matching the field definitions in the installed package
(`better-auth/dist/db/schema/*`). If you change the plugin set in `src/auth.ts`,
add a **new** numbered migration to match — don't edit the applied one.

## Clients

- **CLI / MCP:** `crawlie login` runs the device flow and stores the token in
  `~/.crawlie/auth.json`. See `crates/crawlie-cli/src/auth.rs`.
- **Desktop:** runs the same device flow from the app and persists the token.
- **Web:** hosted pages here; the marketing site links to `/` and account pages.
