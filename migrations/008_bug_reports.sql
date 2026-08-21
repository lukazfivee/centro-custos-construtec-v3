CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descricao TEXT NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'bug',
  severidade VARCHAR(20) NOT NULL DEFAULT 'media',
  status VARCHAR(20) NOT NULL DEFAULT 'aberto',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bug_reports_created_at_idx ON bug_reports (created_at DESC);
CREATE INDEX bug_reports_status_idx ON bug_reports (status);
