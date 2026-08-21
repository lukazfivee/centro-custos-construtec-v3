-- Índices voltados aos filtros, painéis e filas operacionais mais usados.
-- Todos são seguros para bases existentes e podem ser reaplicados sem efeito colateral.

CREATE INDEX IF NOT EXISTS transactions_active_date_id_idx
  ON transactions (transaction_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_active_center_date_idx
  ON transactions (cost_center_id, transaction_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_active_category_date_idx
  ON transactions (category_id, transaction_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_active_type_date_idx
  ON transactions (type, transaction_date DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_pending_due_idx
  ON transactions (due_date, cost_center_id, id)
  WHERE deleted_at IS NULL AND financial_status = 'pendente';

CREATE INDEX IF NOT EXISTS transactions_active_created_idx
  ON transactions (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_active_updated_idx
  ON transactions (updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_document_idx
  ON transactions (document_number)
  WHERE deleted_at IS NULL AND document_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_type_created_idx
  ON audit_log (entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS sync_conflicts_status_created_idx
  ON sync_conflicts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS sync_imports_created_idx
  ON sync_imports (created_at DESC);

CREATE INDEX IF NOT EXISTS suppliers_active_name_idx
  ON suppliers (active, name);

CREATE INDEX IF NOT EXISTS cost_centers_active_name_idx
  ON cost_centers (active, name);

CREATE INDEX IF NOT EXISTS categories_active_name_idx
  ON categories (active, name);
