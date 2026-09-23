const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch { sqlite = null; }

const root = path.join(__dirname, '..');
const LEGACY_SCHEMA = `
CREATE TABLE sync_rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE TABLE cloud_users (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, password_iterations INTEGER NOT NULL DEFAULT 10000,
  role TEXT NOT NULL CHECK (role IN ('admin','gestor','supervisor')), active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT,
  profile_photo_base64 TEXT, profile_photo_mime TEXT
);
CREATE UNIQUE INDEX cloud_users_email_unique ON cloud_users(org_id, email);
CREATE TABLE cloud_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, org_id TEXT NOT NULL, instance_id TEXT, instance_name TEXT,
  created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen_at TEXT NOT NULL
);`;

// Adaptador minimo com a mesma interface do binding D1 usada pelo Worker.
function fakeD1() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(LEGACY_SCHEMA);
  db.exec(fs.readFileSync(path.join(root, 'cloudflare', 'center-container', 'd1-migrations', '006-identidade-compartilhada.sql'), 'utf8'));
  const statement = (sql) => ({
    args: [],
    bind(...args) { this.args = args; return this; },
    async first() { return db.prepare(sql).get(...this.args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...this.args) }; },
    async run() { const r = db.prepare(sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw: db,
    prepare: statement,
    async batch(list) {
      db.exec('BEGIN');
      try { for (const item of list) await item.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

const SERVICE_KEY = 's'.repeat(40);
const SYNC_KEY = 'b'.repeat(40);

async function setup() {
  const auth = await import(pathToFileURL(path.join(root, 'cloudflare', 'center-container', 'centralAuth.js')).href);
  const env = { DB: fakeD1(), CONSTRUTEC_IDENTITY_KEY: SERVICE_KEY, SYNC_SHARED_KEY: SYNC_KEY };
  const call = async (method, pathname, { body, token, service, ip = '203.0.113.9' } = {}) => {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip };
    if (token) headers.authorization = `Bearer ${token}`;
    if (service) { headers['x-construtec-identity-key'] = service; headers['x-construtec-client-ip'] = '198.51.100.7'; }
    if (pathname === '/v1/auth/bootstrap') headers['x-sync-key'] = SYNC_KEY;
    const request = new Request(`https://centro.test${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const response = await auth.handleCentralAuth(request, env);
    return { status: response.status, data: await response.json() };
  };
  await call('POST', '/v1/auth/bootstrap', { body: { name: 'Admin', email: 'admin@rcconstrutec.com.br', password: 'senha-admin-123' } });
  const admin = (await call('POST', '/v1/auth/login', { body: { email: 'admin@rcconstrutec.com.br', password: 'senha-admin-123' } })).data;
  return { env, call, adminToken: admin.sessionToken };
}

const maybe = sqlite ? test : test.skip;

maybe('sessao valida e logout pelo diretorio central', async () => {
  const { call, adminToken } = await setup();
  const session = await call('GET', '/v1/auth/session', { token: adminToken });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.email, 'admin@rcconstrutec.com.br');
  assert.equal((await call('POST', '/v1/auth/logout', { token: adminToken })).status, 200);
  assert.equal((await call('GET', '/v1/auth/session', { token: adminToken })).status, 401);
});

maybe('e-mail externo so vira conta depois de autorizado', async () => {
  const { call, adminToken } = await setup();
  const payload = { name: 'Vendedor', email: 'vendedor@gmail.com', password: 'senha-vendedor-1', role: 'gestor' };
  const blocked = await call('POST', '/v1/users', { token: adminToken, body: payload });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'EMAIL_NOT_AUTHORIZED');
  assert.equal((await call('POST', '/v1/authorized-emails', { token: adminToken, body: { email: 'vendedor@gmail.com', note: 'terceirizado' } })).status, 201);
  const list = await call('GET', '/v1/authorized-emails', { token: adminToken });
  assert.deepEqual(list.data.emails.map((row) => row.email), ['vendedor@gmail.com']);
  assert.equal((await call('POST', '/v1/users', { token: adminToken, body: payload })).status, 201);
  const login = await call('POST', '/v1/auth/login', { body: { email: 'vendedor@gmail.com', password: 'senha-vendedor-1' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'gestor');
});

maybe('excluir login libera o e-mail e preserva a linha antiga', async () => {
  const { env, call, adminToken } = await setup();
  const payload = { name: 'Fulano', email: 'fulano@rcconstrutec.com.br', password: 'senha-fulano-12', role: 'gestor' };
  const first = await call('POST', '/v1/users', { token: adminToken, body: payload });
  const fulanoToken = (await call('POST', '/v1/auth/login', { body: payload })).data.sessionToken;
  assert.equal((await call('POST', '/v1/users/delete', { token: adminToken, body: { email: payload.email } })).status, 200);
  assert.equal((await call('GET', '/v1/auth/session', { token: fulanoToken })).status, 401);
  assert.equal((await call('POST', '/v1/auth/login', { body: payload })).status, 401);
  const second = await call('POST', '/v1/users', { token: adminToken, body: payload });
  assert.equal(second.status, 201);
  assert.notEqual(second.data.user.id, first.data.user.id);
  const rows = env.DB.raw.prepare('SELECT id,deleted_at FROM cloud_users WHERE email=? ORDER BY created_at').all(payload.email);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.id === first.data.user.id && row.deleted_at));
  const listed = await call('GET', '/v1/users', { token: adminToken });
  assert.equal(listed.data.users.filter((user) => user.email === payload.email).length, 1);
  assert.equal((await call('POST', '/v1/users/delete', { token: adminToken, body: { email: 'admin@rcconstrutec.com.br' } })).status, 400);
});

maybe('via de servico do Orcamentos: cria supervisor e nao mexe em admin', async () => {
  const { call, adminToken } = await setup();
  const gestor = { name: 'Gestor', email: 'gestor@rcconstrutec.com.br', password: 'senha-gestor-12', role: 'gestor' };
  await call('POST', '/v1/users', { token: adminToken, body: gestor });
  const gestorToken = (await call('POST', '/v1/auth/login', { body: gestor })).data.sessionToken;

  assert.equal((await call('POST', '/v1/users', { token: gestorToken, body: { ...gestor, email: 'x@rcconstrutec.com.br' } })).status, 403);
  assert.equal((await call('POST', '/v1/users', { token: gestorToken, service: 'errada'.repeat(8), body: { ...gestor, email: 'x@rcconstrutec.com.br' } })).status, 403);

  const created = await call('POST', '/v1/users', { token: gestorToken, service: SERVICE_KEY, body: { ...gestor, email: 'novo@rcconstrutec.com.br', role: 'admin' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.role, 'supervisor');
  const denied = await call('POST', '/v1/users/delete', { token: gestorToken, service: SERVICE_KEY, body: { email: 'admin@rcconstrutec.com.br' } });
  assert.equal(denied.status, 403);
  assert.equal((await call('POST', '/v1/users/delete', { token: gestorToken, service: SERVICE_KEY, body: { email: 'novo@rcconstrutec.com.br' } })).status, 200);
});

maybe('chave de servico curta nao e aceita', async () => {
  const { env, call, adminToken } = await setup();
  env.CONSTRUTEC_IDENTITY_KEY = 'curta';
  const gestor = { name: 'G', email: 'g@rcconstrutec.com.br', password: 'senha-gestor-12', role: 'gestor' };
  await call('POST', '/v1/users', { token: adminToken, body: gestor });
  const token = (await call('POST', '/v1/auth/login', { body: gestor })).data.sessionToken;
  assert.equal((await call('GET', '/v1/users', { token, service: 'curta' })).status, 403);
});

maybe('via de servico com Bearer de admin do Centro continua limitada', async () => {
  const { call, adminToken } = await setup();
  const outro = { name: 'Outro Admin', email: 'outro@rcconstrutec.com.br', password: 'senha-outro-123', role: 'admin' };
  await call('POST', '/v1/users', { token: adminToken, body: outro });
  const created = await call('POST', '/v1/users', { token: adminToken, service: SERVICE_KEY, body: { ...outro, email: 'novo2@rcconstrutec.com.br' } });
  assert.equal(created.data.user.role, 'supervisor');
  assert.equal((await call('POST', '/v1/users/delete', { token: adminToken, service: SERVICE_KEY, body: { email: outro.email } })).status, 403);
});

maybe('excluir com id desatualizado nao atinge conta recriada', async () => {
  const { call, adminToken } = await setup();
  const payload = { name: 'Beltrano', email: 'beltrano@rcconstrutec.com.br', password: 'senha-beltrano-1', role: 'gestor' };
  const first = await call('POST', '/v1/users', { token: adminToken, body: payload });
  await call('POST', '/v1/users/delete', { token: adminToken, body: { email: payload.email, id: first.data.user.id } });
  await call('POST', '/v1/users', { token: adminToken, body: payload });
  const stale = await call('POST', '/v1/users/delete', { token: adminToken, body: { email: payload.email, id: first.data.user.id } });
  assert.equal(stale.status, 404);
  assert.equal((await call('POST', '/v1/auth/login', { body: payload })).status, 200);
});
