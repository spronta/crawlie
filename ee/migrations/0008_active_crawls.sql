-- Registry of currently running crawl jobs, so the dashboard can reattach to
-- them after a page reload (sidebar "Running" section, project progress bars).
-- Rows are inserted when a job starts, deleted when the DO watcher settles,
-- and lazily cleaned up by GET /v1/crawls if a watcher died without settling.
CREATE TABLE IF NOT EXISTS active_crawls (
  job_id     TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  project_id TEXT,                -- NULL = ad-hoc crawl
  url        TEXT NOT NULL,
  max_pages  INTEGER NOT NULL,
  started_at INTEGER NOT NULL     -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_active_crawls_team ON active_crawls (team_id, started_at DESC);
