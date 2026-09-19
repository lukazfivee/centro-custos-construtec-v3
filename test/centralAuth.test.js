const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// centralAuth.js e um modulo ESM (usa `export`), mas o package.json da raiz
// nao declara "type": "module", entao um `require`/`import` direto do
// caminho falharia com SyntaxError. Seguindo o padrao ja usado em
// test/v3-1-profile-photo.test.js e test/v3-1-cloud-worker.test.js, lemos o
// arquivo fonte e o importamos via data: URI com mime text/javascript, o que
// forca o parser ESM independente do "type" do package.json.
async function loadCentralAuth() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'center-container', 'centralAuth.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function fakeDbReturning(row) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => row,
      }),
    }),
  };
}

// Nao ha, neste repositorio, um fake de env.DB/requireSession ja usado por
// handleListUsers/handleCreateUser em test/ (grep -rn "requireSession"
// test/ nao retorna nada) — o unico padrao existente aqui e fakeDbReturning,
// que so cobre uma unica chamada .first(). Os handlers admin exercitados por
// este arquivo (autorizar e-mail externo, excluir login) fazem varias
// chamadas .prepare/.bind/.run/.first diferentes na mesma requisicao
// (rate limit, sessao, e a operacao em si), entao construimos aqui um DB
// fake que roteia por padrao no SQL e grava cada chamada em `calls` para os
// testes inspecionarem os argumentos exatos passados a bind().
function fakeAdminDb({ sessionUserRow = null } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          const record = { sql, args };
          return {
            async first() {
              calls.push({ ...record, op: 'first' });
              if (/JOIN cloud_users u/.test(sql)) return sessionUserRow;
              return null;
            },
            async run() {
              calls.push({ ...record, op: 'run' });
              return { meta: { changes: 1 } };
            },
            async all() {
              calls.push({ ...record, op: 'all' });
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function fakeAdminRequest(pathname, body, { bearer = 'admin-token' } = {}) {
  return {
    url: `https://example.com${pathname}`,
    method: 'POST',
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'authorization') return bearer ? `Bearer ${bearer}` : null;
        if (key === 'cf-connecting-ip') return '127.0.0.1';
        return null;
      },
    },
    json: async () => body,
  };
}

function adminUserRow(overrides = {}) {
  return {
    id: 'admin-1',
    org_id: 'rcconstrutec.com.br',
    name: 'Admin',
    email: 'admin@rcconstrutec.com.br',
    role: 'admin',
    active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    last_login_at: null,
    ...overrides,
  };
}

test('isEmailAllowed aceita e-mail do dominio corporativo mesmo sem estar na lista', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: { prepare: () => { throw new Error('nao deveria consultar o banco para dominio corporativo'); } } };
  assert.equal(await isEmailAllowed(env, 'pessoa@rcconstrutec.com.br'), true);
});

test('isEmailAllowed recusa e-mail externo nao autorizado', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: fakeDbReturning(null) };
  assert.equal(await isEmailAllowed(env, 'fora@gmail.com'), false);
});

test('isEmailAllowed aceita e-mail externo presente na lista de autorizados', async () => {
  const { isEmailAllowed } = await loadCentralAuth();
  const env = { DB: fakeDbReturning({ email: 'fora@gmail.com' }) };
  assert.equal(await isEmailAllowed(env, 'fora@gmail.com'), true);
});

test('handleCentralAuth: autorizar e-mail externo grava na tabela e exige admin', async () => {
  const { handleCentralAuth } = await loadCentralAuth();

  const db = fakeAdminDb({ sessionUserRow: adminUserRow() });
  const env = { DB: db };
  const request = fakeAdminRequest('/v1/users/authorize-external', {
    email: 'Fora@Gmail.com',
    note: 'vendedor terceirizado',
  });
  const response = await handleCentralAuth(request, env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.email, 'fora@gmail.com');

  const insertCall = db.calls.find((c) => /INSERT INTO authorized_external_emails/.test(c.sql));
  assert.ok(insertCall, 'deveria ter inserido/atualizado a linha em authorized_external_emails');
  assert.equal(insertCall.args[0], 'fora@gmail.com');
  assert.equal(insertCall.args[1], 'admin-1');
  assert.equal(insertCall.args[3], 'vendedor terceirizado');

  // Exige sessao de admin: sem sessao valida, deve recusar antes de tocar a tabela.
  const dbSemSessao = fakeAdminDb({ sessionUserRow: null });
  const responseSemSessao = await handleCentralAuth(
    fakeAdminRequest('/v1/users/authorize-external', { email: 'fora@gmail.com' }),
    { DB: dbSemSessao },
  );
  assert.equal(responseSemSessao.status, 401);
  assert.ok(!dbSemSessao.calls.some((c) => /INSERT INTO authorized_external_emails/.test(c.sql)));
});
