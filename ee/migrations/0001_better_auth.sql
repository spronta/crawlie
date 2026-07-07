-- Better Auth schema for Crawlie Cloud (SQLite / Cloudflare D1).
--
-- Tables + columns mirror better-auth@1.6.23 core (user/session/account/
-- verification) plus the device-authorization plugin (deviceCode). If you change
-- the plugin set in src/auth.ts, regenerate against the installed package's
-- schema (better-auth/dist/db/schema/*.mjs and each plugin's schema.mjs) and add
-- a new numbered migration rather than editing this one.
--
-- Apply:  pnpm db:migrate:local   (or :remote for production D1)

CREATE TABLE "user" (
  "id"            text    NOT NULL PRIMARY KEY,
  "name"          text    NOT NULL,
  "email"         text    NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL DEFAULT 0,
  "image"         text,
  "createdAt"     date    NOT NULL,
  "updatedAt"     date    NOT NULL
);

CREATE TABLE "session" (
  "id"        text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token"     text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId"    text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id"                    text NOT NULL PRIMARY KEY,
  "accountId"             text NOT NULL,
  "providerId"            text NOT NULL,
  "userId"                text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  date,
  "refreshTokenExpiresAt" date,
  "scope"                 text,
  "password"              text,
  "createdAt"             date NOT NULL,
  "updatedAt"             date NOT NULL
);

CREATE TABLE "verification" (
  "id"         text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expiresAt"  date NOT NULL,
  "createdAt"  date,
  "updatedAt"  date
);

-- device-authorization plugin (RFC 8628) — powers `crawlie login` on CLI/MCP/desktop.
CREATE TABLE "deviceCode" (
  "id"              text    NOT NULL PRIMARY KEY,
  "deviceCode"      text    NOT NULL,
  "userCode"        text    NOT NULL,
  "userId"          text    REFERENCES "user" ("id") ON DELETE CASCADE,
  "expiresAt"       date    NOT NULL,
  "status"          text    NOT NULL,
  "lastPolledAt"    date,
  "pollingInterval" integer,
  "clientId"        text,
  "scope"           text
);

CREATE INDEX "idx_session_userId"    ON "session" ("userId");
CREATE INDEX "idx_account_userId"    ON "account" ("userId");
CREATE INDEX "idx_verification_ident" ON "verification" ("identifier");
CREATE INDEX "idx_deviceCode_userCode"   ON "deviceCode" ("userCode");
CREATE INDEX "idx_deviceCode_deviceCode" ON "deviceCode" ("deviceCode");
