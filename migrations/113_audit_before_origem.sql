-- Histórico (D7): guarda o registro anterior das edições e de onde veio a ação.
-- Aditiva: linhas antigas ficam com before NULL e origem NULL (a tela mostra "computador").
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS origem VARCHAR(20);
CREATE INDEX IF NOT EXISTS audit_log_user_created_idx ON audit_log (user_id, created_at DESC);
