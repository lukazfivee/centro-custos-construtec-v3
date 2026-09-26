-- Liga a sessão web criada pelo handoff à sessão do app que a originou,
-- para que "Sair" no app encerre as duas (POST /v1/auth/logout).
-- Só aditiva. Aplicar ANTES do deploy do Worker que grava esta coluna.
ALTER TABLE cloud_sessions ADD COLUMN parent_session_hash TEXT;
CREATE INDEX IF NOT EXISTS cloud_sessions_parent ON cloud_sessions(parent_session_hash);
