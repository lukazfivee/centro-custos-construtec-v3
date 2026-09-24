const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = path.join(os.tmpdir(), `centro-handoff-${process.pid}`);
process.env.PGLITE_DATA_DIR = dataDir;
process.env.RESTORE_ROOT_DIR = `${dataDir}-restore`;
process.env.JWT_SECRET = 'jwt-handoff-test-secret-with-thirty-two-chars';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminSenha123!';
delete process.env.DATABASE_URL;

const express = require('express');
const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { setup } = require('./password-reset-fixture.test');

test('ponte emite JWT web válido e a revogação no D1 corta o acesso', async (t) => {
  fs.rmSync(dataDir, { recursive:true, force:true });
  await initializeDatabase();
  process.env.DATABASE_URL = 'postgres://handoff-test';
  process.env.SYNC_API_URL = 'https://centro.test';
  const { env, call, token } = await setup();
  process.env.SYNC_SHARED_KEY = env.SYNC_SHARED_KEY;
  const app = express();
  app.use(express.json());
  app.use('/api/auth',require('../routes/auth'));
  const server = app.listen(0,'127.0.0.1');
  await new Promise((resolve) => server.once('listening',resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = global.fetch;
  const auth = await import('../cloudflare/center-container/centralAuth.js');
  global.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://centro.test/v1/')) {
      if (String(options?.headers?.Authorization || '').startsWith('Bearer hash:')) {
        assert.equal(options.headers['x-sync-key'],env.SYNC_SHARED_KEY);
      }
      return auth.handleCentralAuth(new Request(url,options),env);
    }
    return nativeFetch(input,options);
  };
  env.API = { getByName() { return { fetch: async (request) => nativeFetch(`${local}/api/auth/handoff-bridge`, {
    method:request.method,headers:request.headers,body:await request.text(),
  }) }; } };
  t.after(async () => {
    global.fetch = nativeFetch;
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_SHARED_KEY;
    delete process.env.SYNC_API_URL;
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(dataDir, { recursive:true, force:true });
  });

  const denied = await nativeFetch(`${local}/api/auth/handoff-bridge`, {
    method:'POST',headers:{ 'content-type':'application/json' },body:JSON.stringify({ user:{},sessionHash:'a'.repeat(64) }),
  });
  assert.equal(denied.status,404);
  const issued = await call('POST','/v1/auth/handoff',{ token,body:{ target:'centro-custos' } });
  const consumed = await call('POST','/v1/auth/handoff/consume',{ body:{ code:issued.data.code } });
  assert.equal(consumed.status,200);
  assert.ok(consumed.data.token);
  assert.equal(typeof consumed.data.usuario.id,'number');
  assert.ok(consumed.data.instancia.id);
  const mirror = (await getDb().query('SELECT cloud_session_token FROM users WHERE id=$1',[consumed.data.usuario.id])).rows[0];
  assert.equal(mirror.cloud_session_token,null,'a ponte não grava token bruto no PostgreSQL');
  const me = () => nativeFetch(`${local}/api/auth/me`,{ headers:{ authorization:`Bearer ${consumed.data.token}` } });
  assert.equal((await me()).status,200);
  const photo = await nativeFetch(`${local}/api/auth/foto-perfil`,{ headers:{ authorization:`Bearer ${consumed.data.token}` } });
  assert.equal(photo.status,200,'rotas web que consultam o diretório central usam a referência hash');
  const webSession = env.DB.raw.prepare("SELECT token_hash FROM cloud_sessions WHERE instance_name='Centro de Custos web'").get();
  assert.match(webSession.token_hash,/^[a-f0-9]{64}$/);
  env.DB.raw.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').run(webSession.token_hash);
  assert.equal((await me()).status,401);
});
