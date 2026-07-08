-- Hosted crawl reports. Metadata lives here (fast listing + ownership checks);
-- the full CrawlResult JSON is stored in R2 under reports/<user_id>/<id>.json.
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  url          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  total_pages  INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  warnings     INTEGER NOT NULL DEFAULT 0,
  health_score INTEGER NOT NULL DEFAULT 0,
  geo_score    INTEGER NOT NULL DEFAULT 0,
  a11y_score   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_reports_user_created
  ON reports (user_id, created_at DESC);
