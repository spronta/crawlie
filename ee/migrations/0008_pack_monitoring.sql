-- Rule-pack monitoring: trend the content-rule score over time + alert on
-- content regressions; and let projects post alerts to a webhook (Slack, etc).
ALTER TABLE reports ADD COLUMN pack_score REAL;
ALTER TABLE projects ADD COLUMN notify_webhook TEXT;
