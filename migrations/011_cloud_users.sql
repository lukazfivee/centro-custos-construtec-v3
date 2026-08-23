ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_session_token TEXT;

CREATE INDEX IF NOT EXISTS users_cloud_managed_idx ON users (cloud_managed);
