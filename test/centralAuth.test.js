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

// Fake de env.DB para o endpoint de diretorio (autenticado por x-sync-key,
// nao por sessao): so precisa suportar `.prepare(sql).all()` (sem since) e
// `.prepare(sql).bind(since).all()` (com since), e gravar cada chamada em
// `calls` para os testes inspecionarem o SQL/args exatos.
function fakeDirectoryDb(rows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const exec = async () => {
        calls.push({ sql });
        return { results: rows };
      };
      return {
        bind(...args) {
          calls.push({ sql, args });
          return { all: async () => ({ results: rows }) };
        },
        all: exec,
      };
    },
  };
}

function fakeSyncRequest(pathname, { syncKey = 'segredo-compartilhado' } = {}) {
  return {
    url: `https://example.com${pathname}`,
    method: 'GET',
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'x-sync-key') return syncKey;
        if (key === 'cf-connecting-ip') return '127.0.0.1';
        return null;
      },
    },
  };
}

function directoryUserRow(overrides = {}) {
  return {
    id: 'u1',
    name: 'Pessoa',
    email: 'pessoa@rcconstrutec.com.br',
    password_salt: 'c2FsdA==',
    password_hash: 'aGFzaA==',
    password_iterations: 10000,
    active: 1,
    deleted_at: null,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('handleCentralAuth: diretorio exige x-sync-key e devolve usuarios com hash', async () => {
  const { handleCentralAuth } = await loadCentralAuth();
  const sharedKey = 'segredo-compartilhado';

  // 1. Sem header x-sync-key -> 401, sem tocar o banco.
  const dbSemChave = fakeDirectoryDb([]);
  const responseSemChave = await handleCentralAuth(
    fakeSyncRequest('/v1/identity/directory', { syncKey: null }),
    { DB: dbSemChave, SYNC_SHARED_KEY: sharedKey },
  );
  assert.equal(responseSemChave.status, 401);
  assert.equal(dbSemChave.calls.length, 0, 'nao deveria consultar o banco sem a chave');

  // 2. Header com chave errada -> 401.
  const responseChaveErrada = await handleCentralAuth(
    fakeSyncRequest('/v1/identity/directory', { syncKey: 'chave-errada' }),
    { DB: fakeDirectoryDb([]), SYNC_SHARED_KEY: sharedKey },
  );
  assert.equal(responseChaveErrada.status, 401);

  // 3. Header correto -> 200, body.users e array, cada item tem
  //    passwordHash/passwordSalt/passwordIterations. Inclui uma conta
  //    excluida (deleted_at preenchido) para confirmar que o diretorio NAO
  //    filtra deleted_at (ao contrario de handleLogin/handleListUsers).
  const rows = [
    directoryUserRow(),
    directoryUserRow({
      id: 'u2',
      name: 'Ex Funcionario',
      email: 'exfuncionario@rcconstrutec.com.br',
      active: 0,
      deleted_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    }),
  ];
  const db = fakeDirectoryDb(rows);
  const response = await handleCentralAuth(
    fakeSyncRequest('/v1/identity/directory', { syncKey: sharedKey }),
    { DB: db, SYNC_SHARED_KEY: sharedKey },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.users));
  assert.equal(payload.users.length, 2);
  assert.ok(payload.cursor);

  for (const user of payload.users) {
    assert.ok('passwordHash' in user);
    assert.ok('passwordSalt' in user);
    assert.ok('passwordIterations' in user);
  }

  // Confirmacao explicita exigida pelo brief: a conta excluida (deleted_at
  // preenchido) aparece no diretorio, com active:false e e-mail real
  // preservado — nao e filtrada.
  const excluida = payload.users.find((u) => u.email === 'exfuncionario@rcconstrutec.com.br');
  assert.ok(excluida, 'conta excluida deveria aparecer no diretorio');
  assert.equal(excluida.active, false);
  assert.ok(!db.calls.some((c) => /deleted_at IS NULL/.test(c.sql)), 'a query do diretorio nao deve filtrar deleted_at');

  // 4. Com "since", usa WHERE updated_at > ? com bind do valor.
  const dbSince = fakeDirectoryDb(rows);
  const responseSince = await handleCentralAuth(
    fakeSyncRequest('/v1/identity/directory?since=2026-01-15T00:00:00.000Z', { syncKey: sharedKey }),
    { DB: dbSince, SYNC_SHARED_KEY: sharedKey },
  );
  assert.equal(responseSince.status, 200);
  const sinceCall = dbSince.calls.find((c) => /WHERE updated_at > \?/.test(c.sql));
  assert.ok(sinceCall, 'deveria usar WHERE updated_at > ? quando "since" e informado');
  assert.equal(sinceCall.args[0], '2026-01-15T00:00:00.000Z');
});

test('handleCentralAuth: excluir login marca deleted_at, nao apaga a linha, e libera o e-mail', async () => {
  const { handleCentralAuth } = await loadCentralAuth();

  // 1. Sem sessao de admin -> 401.
  const dbSemSessao = fakeAdminDb({ sessionUserRow: null });
  const responseSemSessao = await handleCentralAuth(
    fakeAdminRequest('/v1/users/delete', { email: 'pessoa@rcconstrutec.com.br' }),
    { DB: dbSemSessao },
  );
  assert.equal(responseSemSessao.status, 401);
  assert.ok(!dbSemSessao.calls.some((c) => /UPDATE cloud_users/.test(c.sql)));

  // 2. Admin tentando excluir a propria conta -> 400.
  const admin = adminUserRow();
  const dbAutoExclusao = fakeAdminDb({ sessionUserRow: admin });
  const responseAutoExclusao = await handleCentralAuth(
    fakeAdminRequest('/v1/users/delete', { email: admin.email }),
    { DB: dbAutoExclusao },
  );
  assert.equal(responseAutoExclusao.status, 400);
  assert.ok(!dbAutoExclusao.calls.some((c) => /UPDATE cloud_users/.test(c.sql)));

  // 3. Exclusao bem sucedida: UPDATE grava deleted_at e active=0, nunca um DELETE FROM cloud_users.
  const dbSucesso = fakeAdminDb({ sessionUserRow: admin });
  const responseSucesso = await handleCentralAuth(
    fakeAdminRequest('/v1/users/delete', { email: 'exfuncionario@rcconstrutec.com.br' }),
    { DB: dbSucesso },
  );
  assert.equal(responseSucesso.status, 200);
  const payloadSucesso = await responseSucesso.json();
  assert.equal(payloadSucesso.ok, true);

  assert.ok(!dbSucesso.calls.some((c) => /DELETE\s+FROM\s+cloud_users/i.test(c.sql)), 'nao deve apagar a linha de cloud_users');
  const updateCall = dbSucesso.calls.find((c) => /UPDATE cloud_users SET active=0, deleted_at=/.test(c.sql));
  assert.ok(updateCall, 'deveria fazer UPDATE cloud_users SET active=0, deleted_at=...');
  assert.match(updateCall.sql, /WHERE org_id=\? AND email=\? AND deleted_at IS NULL/);
  assert.equal(updateCall.args[2], admin.org_id);
  assert.equal(updateCall.args[3], 'exfuncionario@rcconstrutec.com.br');
});

// Fake de env.DB para exercitar handleLogin de ponta a ponta (via
// handleCentralAuth, que tambem aplica o rate limit por IP antes de
// despachar para handleLogin). Roteia por padrao no SQL, igual a
// fakeAdminDb, para os testes poderem inspecionar exatamente quais
// consultas foram feitas.
function fakeLoginDb({ authorizedRow = null, userRow = null, cloudUserCount = 1 } = {}) {
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
              if (/FROM sync_rate_limits/.test(sql)) return null;
              if (/FROM authorized_external_emails/.test(sql)) return authorizedRow;
              if (/COUNT\(\*\) AS total FROM cloud_users/.test(sql)) return { total: cloudUserCount };
              if (/FROM cloud_users WHERE org_id=\? AND email=\? AND deleted_at IS NULL/.test(sql)) return userRow;
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

function fakeLoginRequest(pathname, body) {
  return {
    url: `https://example.com${pathname}`,
    method: 'POST',
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'cf-connecting-ip') return '127.0.0.1';
        return null;
      },
    },
    json: async () => body,
  };
}

test('handleLogin nao recusa mais e-mail externo autorizado apenas pelo formato do e-mail', async () => {
  const { handleCentralAuth } = await loadCentralAuth();

  // E-mail externo (fora@gmail.com), mas presente em authorized_external_emails.
  // Antes da correcao, `validCorporateEmail(email)` recusava direto com 401
  // "E-mail ou senha invalidos." sem sequer consultar o banco de e-mails
  // autorizados nem o diretorio de usuarios. Depois da correcao (uso de
  // isEmailAllowed), o fluxo avanca: consulta authorized_external_emails e,
  // como o e-mail e permitido, segue ate consultar cloud_users -- so entao
  // pode recusar por senha/usuario nao encontrado (mesma mensagem generica,
  // por design, para nao vazar quais e-mails existem).
  const db = fakeLoginDb({ authorizedRow: { email: 'fora@gmail.com' }, userRow: null, cloudUserCount: 1 });
  const request = fakeLoginRequest('/v1/auth/login', { email: 'Fora@Gmail.com', password: 'qualquer-senha' });
  const response = await handleCentralAuth(request, { DB: db });

  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, 'E-mail ou senha invalidos.');

  assert.ok(
    db.calls.some((c) => /FROM authorized_external_emails/.test(c.sql)),
    'deveria consultar a tabela de e-mails externos autorizados (isEmailAllowed), nao recusar so pelo formato',
  );
  assert.ok(
    db.calls.some((c) => /COUNT\(\*\) AS total FROM cloud_users/.test(c.sql)),
    'deveria ter avancado para checar o diretorio de usuarios, nao ter sido recusado antes disso',
  );
});
