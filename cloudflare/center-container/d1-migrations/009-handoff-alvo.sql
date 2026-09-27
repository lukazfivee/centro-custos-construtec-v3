-- Destino do código de handoff (Fase 3 da Suíte): "centro-custos" ou
-- "orcamentos". Um código só vale no destino para o qual foi emitido.
-- Só aditiva. Aplicar ANTES do deploy do Worker que grava esta coluna.
ALTER TABLE session_handoffs ADD COLUMN target TEXT NOT NULL DEFAULT 'centro-custos';
