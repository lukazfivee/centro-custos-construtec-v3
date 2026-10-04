-- D7 do desktop (Configuracoes): telefone da pessoa e marca de "sessoes validas a partir de".
-- Aditiva. phone guarda o celular no modo local; com conta central o Worker segue sendo a
-- fonte e o Centro guarda uma copia.
-- sessions_valid_from: trocar a senha no modo local encerra as sessoes emitidas antes desse instante.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;
