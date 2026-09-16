CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  type VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER,
  progress_message TEXT,
  params JSONB,
  result JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 300000,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_unique ON jobs (type, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_created_by_idx ON jobs (created_by);
CREATE INDEX IF NOT EXISTS jobs_type_idx ON jobs (type);
