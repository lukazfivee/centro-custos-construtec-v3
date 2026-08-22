CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  company TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_email TEXT,
  updated_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_org_email_unique
ON clients(org_id, email);

CREATE INDEX IF NOT EXISTS clients_org_company_idx
ON clients(org_id, company, name);
