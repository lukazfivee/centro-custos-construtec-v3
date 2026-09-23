-- Identidade compartilhada Centro de Custos <-> Orcamentos.
-- JA APLICADA em producao (D1 centro-custos-producao) em 19/09/2026, pelas
-- migracoes 006/007 do branch original. Este arquivo reproduz o mesmo schema
-- para instalacoes novas; nao reaplicar em producao.
--
-- Excluir login marca deleted_at (nunca apaga a linha, para preservar o
-- historico) e libera o e-mail: a unicidade passa a valer so entre contas
-- nao excluidas. E-mails fora do dominio corporativo precisam de
-- autorizacao previa de um admin.
CREATE TABLE IF NOT EXISTS authorized_external_emails (
  email TEXT PRIMARY KEY,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  note TEXT
);
ALTER TABLE cloud_users ADD COLUMN deleted_at TEXT;
DROP INDEX IF EXISTS cloud_users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_email_unique ON cloud_users(org_id, email) WHERE deleted_at IS NULL;
