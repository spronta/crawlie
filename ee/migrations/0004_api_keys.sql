-- Account API keys: let the CLI / MCP / CI authenticate as a Crawlie Cloud
-- account (agent-native access to hosted crawls + reports). Only the SHA-256
-- hash is stored; the plaintext key is shown once at creation.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,          -- e.g. "crw_ab12cd" for display
  key_hash     TEXT NOT NULL,          -- sha-256(full key), hex
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
