CREATE TABLE IF NOT EXISTS client_followups (
  org_id TEXT NOT NULL,
  cost_center_public_id TEXT NOT NULL,
  client_name TEXT,
  client_emails TEXT NOT NULL DEFAULT '[]',
  responsible TEXT,
  operational_status TEXT NOT NULL DEFAULT 'em_execucao',
  financial_status TEXT NOT NULL DEFAULT 'a_faturar',
  invoice_number TEXT,
  contract_amount REAL NOT NULL DEFAULT 0,
  receivable_amount REAL NOT NULL DEFAULT 0,
  completion_date TEXT,
  due_date TEXT,
  notes TEXT,
  updated_by_email TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, cost_center_public_id)
);

CREATE INDEX IF NOT EXISTS client_followups_status_idx
ON client_followups(org_id, operational_status, financial_status);

CREATE TABLE IF NOT EXISTS client_email_drafts (
  org_id TEXT NOT NULL,
  cost_center_public_id TEXT NOT NULL,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  authorized_by_email TEXT,
  authorized_at TEXT,
  sent_by_email TEXT,
  sent_at TEXT,
  resend_email_id TEXT,
  last_error TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, cost_center_public_id)
);

CREATE TABLE IF NOT EXISTS client_email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  cost_center_public_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  recipients_json TEXT,
  attachments_json TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS client_email_events_center_idx
ON client_email_events(org_id, cost_center_public_id, id DESC);
