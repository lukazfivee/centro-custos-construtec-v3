-- Migração 102: Apropriação de Despesas, Reconhecimento de Custos e Medições (Fase 3)
-- Local-First / PGlite e PostgreSQL

-- 1. Apropriação de despesas por linha de controle
CREATE TABLE IF NOT EXISTS expense_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  contract_id UUID REFERENCES project_contracts(id) ON DELETE SET NULL,
  control_item_id UUID REFERENCES budget_control_items(id) ON DELETE SET NULL,
  material_line_id UUID REFERENCES budget_material_lines(id) ON DELETE SET NULL,
  labor_line_id UUID REFERENCES budget_labor_lines(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  quantity NUMERIC(18,4),
  unit TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'unmapped' CHECK (mapping_status IN ('mapped', 'unmapped')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_allocations_tx ON expense_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_cc ON expense_allocations(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_expense_allocations_item ON expense_allocations(control_item_id);

-- 2. Reconhecimento de Custos Gerenciais (Direto, Estornos, Medições)
CREATE TABLE IF NOT EXISTS cost_recognitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  contract_id UUID REFERENCES project_contracts(id) ON DELETE SET NULL,
  allocation_id UUID REFERENCES expense_allocations(id) ON DELETE CASCADE,
  control_item_id UUID REFERENCES budget_control_items(id) ON DELETE SET NULL,
  recognition_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  sign SMALLINT NOT NULL DEFAULT 1 CHECK (sign IN (1, -1)),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'reversed')),
  reversal_of UUID REFERENCES cost_recognitions(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_recognitions_cc_date ON cost_recognitions(cost_center_id, recognition_date);
CREATE INDEX IF NOT EXISTS idx_cost_recognitions_item ON cost_recognitions(control_item_id);

-- 3. Medições de Mão de Obra
CREATE TABLE IF NOT EXISTS labor_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES project_contracts(id) ON DELETE RESTRICT,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'reversed')),
  team_hours NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (team_hours >= 0),
  cost_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labor_measurement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES labor_measurements(id) ON DELETE CASCADE,
  control_item_id UUID NOT NULL REFERENCES budget_control_items(id) ON DELETE RESTRICT,
  team_hours NUMERIC(12,2) NOT NULL CHECK (team_hours >= 0),
  cost_amount NUMERIC(14,2) NOT NULL CHECK (cost_amount >= 0),
  evidence_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_labor_meas_contract ON labor_measurements(contract_id, status);

-- 4. Medições Contratuais ao Cliente (Receita / Avanço Físico)
CREATE TABLE IF NOT EXISTS contract_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES project_contracts(id) ON DELETE RESTRICT,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
  measurement_number INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  measured_amount NUMERIC(14,2) NOT NULL CHECK (measured_amount >= 0),
  billed_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'reversed')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contract_id, measurement_number)
);

-- 5. Backfill seguro: sincronizar apropriações a partir de transaction_allocations existentes
INSERT INTO expense_allocations (id, transaction_id, cost_center_id, amount, mapping_status, created_at)
SELECT
  gen_random_uuid(),
  ta.transaction_id,
  ta.cost_center_id,
  ta.amount,
  'unmapped',
  now()
FROM transaction_allocations ta
WHERE NOT EXISTS (
  SELECT 1 FROM expense_allocations ea
  WHERE ea.transaction_id = ta.transaction_id
    AND ea.cost_center_id = ta.cost_center_id
);
