-- cloudflare-sync-worker/migrations/007-cloud-users-deleted-at.sql
ALTER TABLE cloud_users ADD COLUMN deleted_at TEXT;
DROP INDEX IF EXISTS cloud_users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_email_unique ON cloud_users(org_id, email) WHERE deleted_at IS NULL;
