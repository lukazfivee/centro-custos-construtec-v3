ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS client_report_id TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS central_report_id TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS last_delivery_attempt_at TIMESTAMPTZ;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS platform TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS bug_reports_client_report_id_uidx
  ON bug_reports (client_report_id)
  WHERE client_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bug_reports_delivery_status_idx
  ON bug_reports (delivery_status, created_at DESC);
