-- Migração 101: Modelagem de Baselines, Contratos e Ingestão de Orçamentos
-- Local-First / PGlite e PostgreSQL

CREATE TABLE IF NOT EXISTS budget_import_previews (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  hash TEXT NOT NULL,
  mappings JSONB,
  source_file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'applied', 'invalid', 'expired')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_imports (
  id UUID PRIMARY KEY,
  source_system TEXT NOT NULL,
  namespace_id UUID NOT NULL,
  series_id TEXT NOT NULL,
  source_proposal_id TEXT NOT NULL,
  source_revision INT NOT NULL CHECK (source_revision >= 0),
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_file_hash TEXT,
  imported_by INTEGER REFERENCES users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  contract_id UUID,
  UNIQUE(source_system, namespace_id, series_id, source_revision),
  UNIQUE(source_system, namespace_id, source_proposal_id)
);

CREATE TABLE IF NOT EXISTS budget_import_events (
  id UUID PRIMARY KEY,
  namespace_id UUID NOT NULL,
  event_id UUID NOT NULL,
  import_id UUID NOT NULL REFERENCES budget_imports(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(namespace_id, event_id)
);

CREATE TABLE IF NOT EXISTS project_contracts (
  id UUID PRIMARY KEY,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL,
  namespace_id UUID NOT NULL,
  series_id TEXT NOT NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'closed')),
  current_baseline_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_system, namespace_id, series_id)
);
CREATE INDEX IF NOT EXISTS idx_project_contracts_cost_center ON project_contracts(cost_center_id, status);

CREATE TABLE IF NOT EXISTS budget_baselines (
  id UUID PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES project_contracts(id) ON DELETE RESTRICT,
  import_id UUID NOT NULL REFERENCES budget_imports(id) ON DELETE RESTRICT,
  version INT NOT NULL CHECK (version >= 0),
  predecessor_id UUID REFERENCES budget_baselines(id) ON DELETE RESTRICT,
  client_snapshot JSONB NOT NULL,
  work_snapshot JSONB NOT NULL,
  pricing JSONB NOT NULL,
  materials_cost NUMERIC(14,2) NOT NULL CHECK (materials_cost >= 0),
  labor_cost NUMERIC(14,2) NOT NULL CHECK (labor_cost >= 0),
  base_cost NUMERIC(14,2) NOT NULL CHECK (base_cost >= 0),
  contract_value NUMERIC(14,2) NOT NULL CHECK (contract_value >= 0),
  additions NUMERIC(14,2) NOT NULL,
  sales_rounding_adjustment NUMERIC(14,2) NOT NULL,
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contract_id, version),
  UNIQUE(import_id),
  CONSTRAINT chk_base_cost CHECK (base_cost = materials_cost + labor_cost)
);

CREATE TABLE IF NOT EXISTS budget_control_items (
  id UUID PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES project_contracts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('material', 'labor')),
  canonical_code TEXT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contract_id, id)
);
CREATE INDEX IF NOT EXISTS idx_budget_control_items_contract ON budget_control_items(contract_id, kind);

CREATE TABLE IF NOT EXISTS budget_material_lines (
  id UUID PRIMARY KEY,
  baseline_id UUID NOT NULL REFERENCES budget_baselines(id) ON DELETE RESTRICT,
  control_item_id UUID NOT NULL REFERENCES budget_control_items(id) ON DELETE RESTRICT,
  source_line_id TEXT NOT NULL,
  position INT NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC(14,2) NOT NULL CHECK (total_cost >= 0),
  source_unit_sale NUMERIC(14,2),
  source_total_sale NUMERIC(14,2),
  allocated_sale NUMERIC(14,2) NOT NULL,
  UNIQUE(baseline_id, source_line_id),
  UNIQUE(baseline_id, position)
);

CREATE TABLE IF NOT EXISTS budget_labor_lines (
  id UUID PRIMARY KEY,
  baseline_id UUID NOT NULL REFERENCES budget_baselines(id) ON DELETE RESTRICT,
  control_item_id UUID NOT NULL REFERENCES budget_control_items(id) ON DELETE RESTRICT,
  source_line_id TEXT NOT NULL,
  position INT NOT NULL,
  role_name TEXT NOT NULL,
  cost_basis TEXT NOT NULL CHECK (cost_basis IN ('composition', 'hourly_rate')),
  professional_count NUMERIC(10,2) NOT NULL CHECK (professional_count > 0),
  planned_hours_per_professional NUMERIC(12,2) NOT NULL CHECK (planned_hours_per_professional >= 0),
  planned_team_hours NUMERIC(18,4) NOT NULL CHECK (planned_team_hours >= 0),
  monthly_salary NUMERIC(14,2),
  monthly_food NUMERIC(14,2),
  monthly_transport NUMERIC(14,2),
  monthly_other_costs NUMERIC(14,2),
  standard_monthly_hours NUMERIC(12,2),
  hourly_rate NUMERIC(18,4) NOT NULL CHECK (hourly_rate >= 0),
  total_cost NUMERIC(14,2) NOT NULL CHECK (total_cost >= 0),
  allocated_sale NUMERIC(14,2) NOT NULL,
  UNIQUE(baseline_id, source_line_id),
  UNIQUE(baseline_id, position)
);

CREATE OR REPLACE FUNCTION protect_budget_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BASELINE_LOCKED';
END;
$$;

CREATE TRIGGER baseline_immutable_guard BEFORE UPDATE OR DELETE ON budget_baselines
  FOR EACH ROW EXECUTE FUNCTION protect_budget_baseline();

CREATE TRIGGER baseline_materials_immutable_guard BEFORE UPDATE OR DELETE ON budget_material_lines
  FOR EACH ROW EXECUTE FUNCTION protect_budget_baseline();

CREATE TRIGGER baseline_labor_immutable_guard BEFORE UPDATE OR DELETE ON budget_labor_lines
  FOR EACH ROW EXECUTE FUNCTION protect_budget_baseline();
