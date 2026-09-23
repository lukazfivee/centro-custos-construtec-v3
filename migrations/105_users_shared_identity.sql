-- Espelho local das contas do diretorio central (identidade compartilhada).
-- cloud_user_id liga a linha local ao id da conta no D1. Uma conta excluida
-- no diretorio fica marcada com deleted_at e deixa de contar para a
-- unicidade do e-mail, que pode voltar numa conta nova (id novo), sem
-- desvincular o historico da linha antiga.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DROP INDEX IF EXISTS users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_live_unique ON users (LOWER(email)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_cloud_user_id_unique ON users (cloud_user_id) WHERE cloud_user_id IS NOT NULL;
