const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('lançamento com client_id: reenviar não duplica (fila offline do celular)', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-idempotencia-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'idempotencia-secret-com-mais-de-32-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'idempotencia-123';
  process.env.ADMIN_INITIAL_EMAIL = 'idempotencia@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const db = getDb();
  let token = '';

  async function call(route, method, body) {
    const response = await fetch(base + route, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  token = (await call('/auth/login', 'POST', { email: 'idempotencia@teste.local', senha: 'idempotencia-123' })).body.token;
  const categories = (await call('/categorias', 'GET')).body;
  const category = (categories.find((c) => c.tipo === 'ambos') || categories.find((c) => c.tipo === 'despesa')).id;
  const center = (await call('/centros-custo', 'POST', { codigo: 'IDEM-01', nome: 'Obra Idempotência', orcamento: 0, situacao: 'execucao' })).body.id;
  const despesa = (overrides = {}) => ({
    tipo: 'despesa', cost_center_id: center, category_id: category, descricao: 'Cabos da obra',
    valor: 150.5, data: '2026-09-20', status_financeiro: 'pendente', vencimento: '2026-10-15', ...overrides,
  });
  const countFor = async (clientId) => (await db.query(
    'SELECT count(*)::int AS n FROM transactions WHERE client_id=$1', [clientId])).rows[0].n;

  await context.test('primeiro envio cria (201); reenvio igual devolve o mesmo (200) sem duplicar', async () => {
    const clientId = crypto.randomUUID();
    const first = await call('/lancamentos', 'POST', despesa({ client_id: clientId }));
    assert.equal(first.status, 201);
    const again = await call('/lancamentos', 'POST', despesa({ client_id: clientId.toUpperCase() }));
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.body.public_id, first.body.public_id);
    assert.equal(again.body.replayed, true);
    assert.equal(await countFor(clientId), 1);
  });

  await context.test('mesmo client_id com dados diferentes responde 409', async () => {
    const clientId = crypto.randomUUID();
    assert.equal((await call('/lancamentos', 'POST', despesa({ client_id: clientId }))).status, 201);
    const conflict = await call('/lancamentos', 'POST', despesa({ client_id: clientId, valor: 999 }));
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.erro, /identificador já foi usado/);
    assert.equal(await countFor(clientId), 1);
  });

  await context.test('client_id inválido responde 400 e nada é gravado', async () => {
    const out = await call('/lancamentos', 'POST', despesa({ client_id: 'nao-e-uuid' }));
    assert.equal(out.status, 400);
    assert.match(out.body.erro, /client_id/);
  });

  await context.test('envios simultâneos do mesmo lançamento gravam uma vez só', async () => {
    const clientId = crypto.randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => call('/lancamentos', 'POST', despesa({ client_id: clientId }))));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 201]);
    assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
    assert.equal(await countFor(clientId), 1);
  });

  await context.test('reenvio depois de excluir não recria o lançamento', async () => {
    const clientId = crypto.randomUUID();
    const first = await call('/lancamentos', 'POST', despesa({ client_id: clientId }));
    await db.query('UPDATE transactions SET deleted_at=NOW() WHERE id=$1', [first.body.id]);
    const again = await call('/lancamentos', 'POST', despesa({ client_id: clientId }));
    assert.equal(again.status, 200);
    assert.equal(again.body.excluido, true);
    assert.equal(await countFor(clientId), 1);
  });

  await context.test('reenvio completa a auditoria que faltou na primeira tentativa, sem duplicar', async () => {
    const clientId = crypto.randomUUID();
    const first = await call('/lancamentos', 'POST', despesa({ client_id: clientId }));
    const audits = async () => (await db.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE entity_type='lancamento' AND entity_id=$1 AND action='criado'", [first.body.public_id])).rows[0].n;
    assert.equal(await audits(), 1);
    await db.query("DELETE FROM audit_log WHERE entity_type='lancamento' AND entity_id=$1", [first.body.public_id]);
    assert.equal((await call('/lancamentos', 'POST', despesa({ client_id: clientId }))).status, 200);
    assert.equal(await audits(), 1);
    assert.equal((await call('/lancamentos', 'POST', despesa({ client_id: clientId }))).status, 200);
    assert.equal(await audits(), 1);
  });

  await context.test('sem client_id continua como antes: cada envio cria um lançamento', async () => {
    const before = (await db.query("SELECT count(*)::int AS n FROM transactions WHERE description='Sem identificador'")).rows[0].n;
    assert.equal((await call('/lancamentos', 'POST', despesa({ descricao: 'Sem identificador' }))).status, 201);
    assert.equal((await call('/lancamentos', 'POST', despesa({ descricao: 'Sem identificador' }))).status, 201);
    const after = (await db.query("SELECT count(*)::int AS n FROM transactions WHERE description='Sem identificador'")).rows[0].n;
    assert.equal(after - before, 2);
  });
});
