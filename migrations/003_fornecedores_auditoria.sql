CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(30),
  contact_name VARCHAR(120),
  email VARCHAR(180),
  phone VARCHAR(40),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX suppliers_name_unique ON suppliers (LOWER(name));

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(80),
  action VARCHAR(30) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  data JSONB,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(120) NOT NULL,
  instance_id UUID NOT NULL,
  instance_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
