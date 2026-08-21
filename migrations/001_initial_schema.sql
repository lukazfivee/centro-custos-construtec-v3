CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'gestor', 'supervisor')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_unique ON users (LOWER(email));

CREATE TABLE cost_centers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(140) NOT NULL,
  responsible VARCHAR(120),
  monthly_budget NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_budget >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX cost_centers_code_unique ON cost_centers (LOWER(code));

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'ambos' CHECK (type IN ('receita', 'despesa', 'ambos')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX categories_name_unique ON categories (LOWER(name));

CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  public_id UUID NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('receita', 'despesa')),
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description VARCHAR(240) NOT NULL,
  counterparty VARCHAR(160),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL,
  notes TEXT,
  origin_instance_id UUID NOT NULL,
  origin_instance_name VARCHAR(120) NOT NULL,
  last_modified_instance_id UUID NOT NULL,
  last_modified_instance_name VARCHAR(120) NOT NULL,
  origin_user_name VARCHAR(120) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  last_imported_at TIMESTAMPTZ
);
CREATE INDEX transactions_date_idx ON transactions (transaction_date DESC);
CREATE INDEX transactions_cost_center_idx ON transactions (cost_center_id);
CREATE INDEX transactions_category_idx ON transactions (category_id);
CREATE INDEX transactions_type_idx ON transactions (type);

CREATE TABLE sync_imports (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(240) NOT NULL,
  source_instance_id UUID,
  source_instance_name VARCHAR(120),
  imported_by INTEGER NOT NULL REFERENCES users(id),
  included_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_conflicts (
  id SERIAL PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES sync_imports(id),
  transaction_public_id UUID,
  reason TEXT NOT NULL,
  local_data JSONB,
  incoming_data JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO categories (name, type) VALUES
  ('Vendas e serviços', 'receita'),
  ('Aportes e reembolsos', 'receita'),
  ('Material', 'despesa'),
  ('Mão de obra', 'despesa'),
  ('Equipamentos', 'despesa'),
  ('Transporte', 'despesa'),
  ('Serviços terceirizados', 'despesa'),
  ('Administrativo', 'despesa'),
  ('Outros', 'ambos');
