-- Obras descartadas por um administrador (so as sem movimento financeiro). O conteudo fica aqui,
-- em JSON, para a obra poder ser recuperada; o registro de quem descartou e quando e permanente.
CREATE TABLE IF NOT EXISTS discarded_cost_centers (
  id SERIAL PRIMARY KEY,
  cost_center_public_id TEXT NOT NULL,
  code TEXT,
  name TEXT,
  reason TEXT,
  payload JSONB NOT NULL,
  discarded_by INTEGER,
  discarded_by_name TEXT,
  discarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at TIMESTAMPTZ,
  restored_by_name TEXT
);
CREATE INDEX IF NOT EXISTS discarded_cost_centers_public_id ON discarded_cost_centers (cost_center_public_id);
