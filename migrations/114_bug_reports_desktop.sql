-- Reports do desktop: onde aconteceu, diagnostico, resposta da equipe e print anexado.
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS tela VARCHAR(120);
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS diagnostico JSONB;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS resposta_equipe TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS respondido_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS bug_report_anexos (
  report_id INTEGER PRIMARY KEY REFERENCES bug_reports(id) ON DELETE CASCADE,
  nome VARCHAR(160) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  tamanho INTEGER NOT NULL,
  dados BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
