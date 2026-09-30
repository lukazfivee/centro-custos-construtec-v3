-- D6 do desktop: seis papéis da Suíte, apps por usuário e matriz de permissões.
-- Só aditiva; os ALTER TABLE não são idempotentes: rodar uma vez, antes do deploy do Worker.
-- `role` (admin|gestor|supervisor) continua valendo para o Orçamentos e clientes antigos.
-- Enquanto suite_role for NULL, o papel efetivo vem do mapeamento: supervisor -> tecnico.
ALTER TABLE cloud_users ADD COLUMN suite_role TEXT;
ALTER TABLE cloud_users ADD COLUMN apps TEXT;
-- Convites guardam o papel novo e os apps para a conta nascer certa.
ALTER TABLE signup_invites ADD COLUMN suite_role TEXT;
ALTER TABLE signup_invites ADD COLUMN apps TEXT;

-- Só as diferenças em relação à matriz padrão do código (suiteRoles.js).
-- "Restaurar padrão" apaga todas as linhas.
CREATE TABLE IF NOT EXISTS role_permission_overrides (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
