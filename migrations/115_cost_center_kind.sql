-- Obra ou servico: servicos curtos (instalar uma camera, remanejar um rack) ficam separados das obras.
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'obra';
ALTER TABLE cost_centers DROP CONSTRAINT IF EXISTS cost_centers_kind_check;
ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_kind_check CHECK (kind IN ('obra','servico'));
