-- Identidade compartilhada Centro de Custos <-> Orcamentos.
-- Excluir login marca deleted_at (nunca apaga a linha, para preservar o
-- historico) e libera o e-mail: a unicidade passa a valer so entre contas
-- nao excluidas. E-mails fora do dominio corporativo precisam de
-- autorizacao previa de um admin.
ALTER TABLE cloud_users ADD COLUMN deleted_at TEXT;
DROP INDEX IF EXISTS cloud_users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_email_live_unique
  ON cloud_users(org_id, email) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS authorized_external_emails (
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (org_id, email)
);
