CREATE TABLE IF NOT EXISTS cost_center_invoices (
  cost_center_id BIGINT PRIMARY KEY REFERENCES cost_centers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by BIGINT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cost_center_invoices_updated_idx
ON cost_center_invoices(updated_at DESC);
