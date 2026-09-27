-- Fase 4 da Suíte mobile: notificações. Só aditiva. Aplicar ANTES do deploy.
-- Aparelho com o app (token do Firebase Cloud Messaging), um por conta e instalação.
CREATE TABLE IF NOT EXISTS push_devices (
  user_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  instance_name TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, instance_id)
);
CREATE INDEX IF NOT EXISTS push_devices_token ON push_devices(fcm_token);

-- Aparelhos que já entraram na conta, para o aviso de "novo acesso".
CREATE TABLE IF NOT EXISTS known_devices (
  user_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, instance_id)
);

-- Central de notificações. dedupe_key evita repetir o mesmo aviso para a mesma pessoa.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  app TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Preferências por pessoa; sem linha, o tipo está ligado.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (user_id, type)
);
