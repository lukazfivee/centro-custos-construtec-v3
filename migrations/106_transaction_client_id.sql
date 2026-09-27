-- Identificador gerado no celular para lançamentos feitos offline (Fase 2 mobile).
-- Reenviar o mesmo lançamento devolve o registro existente em vez de duplicar.
-- Só aditiva.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_client_id_unique
  ON transactions (created_by, client_id) WHERE client_id IS NOT NULL;
