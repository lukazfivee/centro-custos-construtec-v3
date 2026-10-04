-- Pendencias conhecidas no momento do fechamento (D7). Aditiva: fechamentos antigos ficam sem lista (NULL).
-- Formato: [{ chave, titulo, quantidade, valor?, detalhe? }]. O motivo de reabertura fica na auditoria.
ALTER TABLE monthly_closings ADD COLUMN IF NOT EXISTS pendencias JSONB;
