CREATE TABLE IF NOT EXISTS sync_entities (
  org_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  public_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_instance_id TEXT,
  source_instance_name TEXT,
  source_user_email TEXT,
  event_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  server_updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, entity_type, public_id)
);

CREATE INDEX IF NOT EXISTS sync_entities_event_idx
  ON sync_entities(org_id, event_id);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  public_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT,
  payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_instance_id TEXT,
  source_instance_name TEXT,
  source_user_email TEXT,
  resolution TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_events_org_id_idx
  ON sync_events(org_id, id);

CREATE INDEX IF NOT EXISTS sync_events_entity_idx
  ON sync_events(org_id, entity_type, public_id, id DESC);

CREATE TABLE IF NOT EXISTS sync_clients (
  org_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  instance_name TEXT,
  last_user_email TEXT,
  app_version TEXT,
  platform TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (org_id, instance_id)
);

CREATE TABLE IF NOT EXISTS sync_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_rate_limits_expiry_idx
  ON sync_rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS cloud_users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  role TEXT NOT NULL CHECK (role IN ('admin','gestor','supervisor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_email_unique
  ON cloud_users(org_id, email);

CREATE TABLE IF NOT EXISTS cloud_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  instance_id TEXT,
  instance_name TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cloud_sessions_user_idx
  ON cloud_sessions(user_id, expires_at);

CREATE INDEX IF NOT EXISTS cloud_sessions_expiry_idx
  ON cloud_sessions(expires_at);
