CREATE TABLE IF NOT EXISTS transaction_attachments (
  id SERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  original_name VARCHAR(240) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 VARCHAR(64) NOT NULL,
  content BYTEA NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'comprovante'
    CHECK (category IN ('comprovante','nota_fiscal','boleto','recibo','contrato','outro')),
  notes VARCHAR(500),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS transaction_attachments_transaction_hash_unique
  ON transaction_attachments (transaction_id, sha256);
CREATE INDEX IF NOT EXISTS transaction_attachments_transaction_idx
  ON transaction_attachments (transaction_id, created_at DESC);
