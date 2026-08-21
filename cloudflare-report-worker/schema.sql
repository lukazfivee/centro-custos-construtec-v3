CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL UNIQUE,
  client_report_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  installation_name TEXT NOT NULL,
  app_version TEXT,
  platform TEXT,
  source_ip TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_id TEXT,
  email_error TEXT,
  created_at TEXT NOT NULL,
  emailed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS reports_email_status_idx ON reports(email_status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_installation_idx ON reports(installation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS report_rate_expiry_idx ON report_rate_limits(expires_at);
