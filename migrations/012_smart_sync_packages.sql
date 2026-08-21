CREATE TABLE IF NOT EXISTS sync_package_imports (
  id SERIAL PRIMARY KEY,
  package_id UUID NOT NULL UNIQUE,
  filename VARCHAR(240) NOT NULL,
  source_instance_id UUID,
  source_instance_name VARCHAR(120),
  package_hash VARCHAR(64) NOT NULL,
  imported_by INTEGER NOT NULL REFERENCES users(id),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_package_imports_created_at_idx
  ON sync_package_imports (created_at DESC);

CREATE TABLE IF NOT EXISTS sync_package_conflicts (
  id SERIAL PRIMARY KEY,
  package_import_id INTEGER NOT NULL REFERENCES sync_package_imports(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('categoria','obra','fornecedor','lancamento')),
  entity_public_id UUID NOT NULL,
  reason TEXT NOT NULL,
  local_data JSONB,
  incoming_data JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_choice VARCHAR(20) CHECK (resolved_choice IS NULL OR resolved_choice IN ('local','recebido')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_package_conflicts_status_idx
  ON sync_package_conflicts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_package_conflicts_entity_idx
  ON sync_package_conflicts (entity_type, entity_public_id);
