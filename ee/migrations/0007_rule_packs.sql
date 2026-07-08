-- Rule packs: editable, deterministic .crawlie content rules (slop / brand /
-- tone / required-phrases) a team runs on every crawl. Marketing monitoring as
-- code — the moat from the revenue plan.
CREATE TABLE IF NOT EXISTS rule_packs (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  source     TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_packs_team ON rule_packs (team_id, created_at DESC);
