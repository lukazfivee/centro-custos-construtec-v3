-- Exclusão local permanente por identificador público. Pacotes antigos não recriam a obra.
CREATE TABLE IF NOT EXISTS cost_center_tombstones (
  public_id UUID PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
