CREATE TABLE IF NOT EXISTS recurring_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(140) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('receita','despesa')),
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  counterparty VARCHAR(160),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(40),
  day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 31),
  frequency VARCHAR(20) NOT NULL DEFAULT 'mensal' CHECK (frequency IN ('mensal','bimestral','trimestral','semestral','anual')),
  total_installments INTEGER CHECK (total_installments > 0),
  current_installment INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
