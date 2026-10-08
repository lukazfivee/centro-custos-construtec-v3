-- Servicos curtos (cost_centers.kind='servico'): situacao, local, checklist, fotos, aceite do cliente e faturamento.
-- Codigo, cliente, data, responsavel, valor cobrado e descricao continuam em cost_centers
-- (code, client, start_date, responsible, contract_amount, description). Ver docs/suite-desktop/SERVICOS-API.md.
CREATE TABLE IF NOT EXISTS service_jobs (
  cost_center_id INTEGER PRIMARY KEY REFERENCES cost_centers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','em_andamento','concluido','faturado')),
  location TEXT,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  completed_by_name TEXT,
  completed_pending JSONB,
  accept_name TEXT,
  accept_role TEXT,
  accept_at TIMESTAMPTZ,
  accept_signature BYTEA,
  accept_by_name TEXT,
  billed_at TIMESTAMPTZ,
  billed_by_name TEXT,
  billing_amount NUMERIC(14,2),
  billing_due_days INTEGER,
  billing_due_date DATE,
  billing_method TEXT CHECK (billing_method IS NULL OR billing_method IN ('pix','boleto','transferencia')),
  nfse_number TEXT,
  billing_cloud_synced BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_photos (
  id SERIAL PRIMARY KEY,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('antes','depois')),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  sha256 TEXT NOT NULL,
  content BYTEA NOT NULL,
  caption TEXT,
  created_by INTEGER,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS service_photos_center_idx ON service_photos (cost_center_id, phase);

-- Tipo do gasto (lancamento rapido do servico). Nulo nos lancamentos comuns: o resumo deduz pelo nome da categoria.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expense_kind TEXT;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_expense_kind_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_expense_kind_check
  CHECK (expense_kind IS NULL OR expense_kind IN ('deslocamento','combustivel','material','mao_de_obra','outros'));
