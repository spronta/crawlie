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

## Deployment

Provisioning, secrets, and deploy steps for Crawlie Cloud are **internal** and
not documented in this public repository. If you're on the Spronta team, see the
internal runbook. This service is not intended to be self-hosted — see the
license note above.

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
