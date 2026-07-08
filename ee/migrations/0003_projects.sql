-- Projects: a saved site an account owns, re-crawlable on a schedule with
-- regression monitoring. The backbone of Crawlie Cloud accounts.
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  config        TEXT,                        -- JSON crawl-config overrides
  schedule      TEXT NOT NULL DEFAULT 'off', -- off | daily | weekly | monthly
  notify        INTEGER NOT NULL DEFAULT 1,  -- email on regressions
  next_run_at   INTEGER,                     -- epoch ms; NULL when schedule=off
  last_crawl_at INTEGER,
  last_health   INTEGER,
  last_report   TEXT,                        -- id of the most recent report
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id, created_at DESC);
-- Due-schedule scan for the cron trigger.
CREATE INDEX IF NOT EXISTS idx_projects_due ON projects (next_run_at);

-- Tie each stored report to its project (NULL = ad-hoc one-off crawl).
ALTER TABLE reports ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_reports_project
  ON reports (user_id, project_id, created_at DESC);
