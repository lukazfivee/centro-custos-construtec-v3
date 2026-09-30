-- D6 do desktop: papel novo da Suite, apps e obras por usuario.
-- Aditiva. `role` (admin|gestor|supervisor) continua sendo o papel legado espelhado do diretorio central.
-- suite_role NULL = ainda sem papel novo: vale o mapeamento (supervisor -> tecnico).
-- all_cost_centers TRUE = ve todas as obras; contas existentes ficam TRUE para nao perder acesso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS suite_role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apps TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS all_cost_centers BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_cost_centers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, cost_center_id)
);
CREATE INDEX IF NOT EXISTS user_cost_centers_cc ON user_cost_centers (cost_center_id);
