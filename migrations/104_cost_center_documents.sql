CREATE TABLE IF NOT EXISTS cost_center_proposals (
  cost_center_id INTEGER PRIMARY KEY REFERENCES cost_centers(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_center_invoices_ledger (
  id SERIAL PRIMARY KEY,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('fornecedor', 'cliente')),
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  content BYTEA,
  data_emissao DATE,
  valor NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nao_paga' CHECK (status IN ('paga', 'nao_paga')),
  observacao TEXT,
  uploaded_by INTEGER,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cc_invoices_ledger_center ON cost_center_invoices_ledger(cost_center_id, tipo);
