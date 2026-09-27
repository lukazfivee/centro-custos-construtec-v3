-- Fase 5 da Suíte mobile: cadastro pelo app com aprovação do admin e convites.
-- Só aditiva, mas os ALTER TABLE não são idempotentes: rodar uma vez, antes do deploy.
CREATE TABLE IF NOT EXISTS signup_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  role TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  user_id TEXT
);
CREATE INDEX IF NOT EXISTS signup_requests_status ON signup_requests(org_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_pending_email ON signup_requests(org_id, email) WHERE status = 'pending';

-- Convite por e-mail: o link leva o código de uso único; a conta sai aprovada.
CREATE TABLE IF NOT EXISTS signup_invites (
  token_hash TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS signup_invites_email ON signup_invites(org_id, email);

-- Configurações da empresa (por enquanto, o código de cadastro).
CREATE TABLE IF NOT EXISTS org_settings (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, key)
);

-- Celular informado no cadastro e o tour do primeiro acesso.
ALTER TABLE cloud_users ADD COLUMN phone TEXT;
ALTER TABLE cloud_users ADD COLUMN tour_pending INTEGER NOT NULL DEFAULT 0;
