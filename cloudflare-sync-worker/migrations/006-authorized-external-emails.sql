-- cloudflare-sync-worker/migrations/006-authorized-external-emails.sql
CREATE TABLE IF NOT EXISTS authorized_external_emails (
  email TEXT PRIMARY KEY,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  note TEXT
);
