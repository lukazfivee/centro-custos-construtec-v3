CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  scope VARCHAR(30) NOT NULL DEFAULT 'lancamentos',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, scope, name)
);

CREATE TABLE IF NOT EXISTS transaction_allocations (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(transaction_id, cost_center_id)
);
CREATE INDEX IF NOT EXISTS transaction_allocations_transaction_idx ON transaction_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS transaction_allocations_center_idx ON transaction_allocations(cost_center_id);

CREATE TABLE IF NOT EXISTS financial_accounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  account_type VARCHAR(20) NOT NULL DEFAULT 'banco' CHECK (account_type IN ('banco','caixa','cartao','adiantamento')),
  institution VARCHAR(100),
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_accounts_name_unique ON financial_accounts(LOWER(name));

CREATE TABLE IF NOT EXISTS bank_movements (
  id SERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES financial_accounts(id),
  movement_date DATE NOT NULL,
  description VARCHAR(240) NOT NULL,
  counterparty VARCHAR(180),
  document_number VARCHAR(100),
  amount NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  source_hash VARCHAR(64),
  transaction_id INTEGER REFERENCES transactions(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','conciliado','ignorado')),
  imported_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_movements_source_hash_unique ON bank_movements(source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_movements_status_date_idx ON bank_movements(status,movement_date DESC);
CREATE INDEX IF NOT EXISTS bank_movements_transaction_idx ON bank_movements(transaction_id);

CREATE TABLE IF NOT EXISTS backup_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours BETWEEN 1 AND 168),
  retention_count INTEGER NOT NULL DEFAULT 30 CHECK (retention_count BETWEEN 3 AND 180),
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO backup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'aprovado'
  CHECK (approval_status IN ('rascunho','pendente','aprovado','rejeitado'));
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS transactions_approval_status_idx ON transactions(approval_status);
