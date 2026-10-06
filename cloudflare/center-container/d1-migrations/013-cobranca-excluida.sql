-- Exclusao reversivel de cobrancas (tela Cobrancas do desktop).
-- Aditiva: nao apaga a obra, lancamentos, medicoes nem NF; so marca a cobranca como excluida.
-- Os ALTER TABLE nao sao idempotentes: rodar uma vez, ANTES do deploy do Worker.
-- Cobranca sem linha em client_followups ganha a linha (com os padroes da obra) ao ser excluida.
ALTER TABLE client_followups ADD COLUMN deleted_at TEXT;
ALTER TABLE client_followups ADD COLUMN deleted_by_email TEXT;
ALTER TABLE client_followups ADD COLUMN deleted_reason TEXT;
