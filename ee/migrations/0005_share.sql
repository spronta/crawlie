-- Public shareable reports: a report can be published to a read-only URL
-- (crawlie.app/p/<token>) that anyone can open without an account — something
-- a desktop crawler can't do.
ALTER TABLE reports ADD COLUMN share_token TEXT;
CREATE INDEX IF NOT EXISTS idx_reports_share ON reports (share_token);
