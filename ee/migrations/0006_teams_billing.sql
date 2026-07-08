-- Teams + billing substrate. Projects/reports become team-owned so members
-- share them; plan + usage live on the team; Stripe fields drive monetization.

CREATE TABLE IF NOT EXISTS teams (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  plan                TEXT NOT NULL DEFAULT 'free',   -- free | pro | business
  stripe_customer     TEXT,
  stripe_subscription TEXT,
  owner_id            TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',          -- owner | admin | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

CREATE TABLE IF NOT EXISTS team_invites (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites (email);

-- Monthly usage counters, keyed by team + 'YYYY-MM'.
CREATE TABLE IF NOT EXISTS usage (
  team_id TEXT NOT NULL,
  period  TEXT NOT NULL,
  crawls  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, period)
);

ALTER TABLE projects ADD COLUMN team_id TEXT;
ALTER TABLE reports ADD COLUMN team_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_team ON reports (team_id, created_at DESC);
