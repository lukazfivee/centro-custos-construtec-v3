const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { DatabaseSync = null; }

const root = path.join(__dirname, '..');
const worker = path.join(root, 'cloudflare', 'center-container');
const schema = `
CREATE TABLE sync_rate_limits (bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE cloud_users (id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,
 password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,password_iterations INTEGER NOT NULL DEFAULT 10000,
 role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 last_login_at TEXT,profile_photo_base64 TEXT,profile_photo_mime TEXT);
CREATE UNIQUE INDEX cloud_users_email_unique ON cloud_users(org_id,email);
CREATE TABLE cloud_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,org_id TEXT NOT NULL,
 instance_id TEXT,instance_name TEXT,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen_at TEXT NOT NULL);`;

function fakeD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(schema);
  for (const name of ['006-identidade-compartilhada.sql', '007-mobile-auth.sql']) {
    raw.exec(fs.readFileSync(path.join(worker, 'd1-migrations', name), 'utf8'));
  }
  const prepare = (sql) => ({
    args: [], bind(...args) { this.args = args; return this; },
    async first() { return raw.prepare(sql).get(...this.args) ?? null; },
    async all() { return { results: raw.prepare(sql).all(...this.args) }; },
    async run() { const result = raw.prepare(sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; },
  });
  return {
    raw, prepare,
    async batch(list) {
      raw.exec('BEGIN');
      try { const results = []; for (const item of list) results.push(await item.run()); raw.exec('COMMIT'); return results; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
}

async function setup() {
  const auth = await import(pathToFileURL(path.join(worker, 'centralAuth.js')).href);
  const env = { DB: fakeD1(), SYNC_SHARED_KEY: 'b'.repeat(40) };
  const call = async (method, pathname, { body, token, ip = '203.0.113.9', headers: extra = {} } = {}) => {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    if (pathname === '/v1/auth/bootstrap') headers['x-sync-key'] = env.SYNC_SHARED_KEY;
    const request = new Request(`https://centro.test${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const response = await auth.handleCentralAuth(request, env);
    return { status: response.status, data: await response.json() };
  };
  const email = 'admin@rcconstrutec.com.br';
  const password = 'SenhaInicial9!';
  await call('POST', '/v1/auth/bootstrap', { body: { name: 'Admin', email, password } });
  const login = await call('POST', '/v1/auth/login', { body: { email, password } });
  return { env, call, email, password, token: login.data.sessionToken };
}

module.exports = { setup, hasSQLite: Boolean(DatabaseSync) };
