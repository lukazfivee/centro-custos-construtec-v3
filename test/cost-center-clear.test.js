const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-clear-test-'));
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = path.join(tempDir, 'data');
process.env.JWT_SECRET = 'test-jwt-secret-with-minimum-32-chars-long';
process.env.ADMIN_INITIAL_EMAIL = 'limpar@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'LimparPassword123!';

const { initializeDatabase, getDb, closeDatabase } = require('../db');
const { createApp } = require('../server');

test('excluir todos os lancamentos e recorrentes da obra libera o descarte', async (context) => {
  await initializeDatabase();
  const db = getDb();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const call = async (method, url, token, body) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const admin = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'limpar@teste.local', senha: 'LimparPassword123!' }) })).json()).token;

  const obra = await call('POST', '/centros-custo', admin, { codigo: 'LIMPA-1', nome: 'Obra para limpar' });
  assert.equal(obra.status, 201);
  const id = obra.data.id;
  const category = (await call('GET', '/categorias', admin)).data[0].id;
  for (const valor of [10, 20]) {
    assert.equal((await call('POST', '/lancamentos', admin, { tipo: 'despesa', cost_center_id: id, category_id: category, descricao: `Gasto ${valor}`, valor, data: '2026-09-15', status_financeiro: 'pendente' })).status, 201);
  }
  const adminId = (await db.query("SELECT id FROM users WHERE email='limpar@teste.local'")).rows[0].id;
  await db.query('INSERT INTO recurring_templates (name,type,cost_center_id,category_id,amount,frequency,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['Aluguel', 'despesa', id, category, 10, 'mensal', adminId]);
  assert.equal((await call('POST', `/centros-custo/${id}/descartar`, admin, { confirmar: 'LIMPA-1' })).status, 409);

  assert.equal((await call('POST', `/centros-custo/${id}/excluir-lancamentos`, admin, { confirmar: 'errado' })).status, 400);
  const cleared = await call('POST', `/centros-custo/${id}/excluir-lancamentos`, admin, { confirmar: 'limpa-1' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  assert.equal(cleared.data.excluidos, 2);
  assert.equal(cleared.data.recorrentes, 1);
  assert.deepEqual(cleared.data.ignorados, []);
  assert.deepEqual(cleared.data.impedimentos, { lancamentos: 0, rateios: 0, recorrentes: 0, medicoes: 0, notas: 0 });
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM transactions WHERE cost_center_id=$1 AND deleted_at IS NOT NULL', [id])).rows[0].n, 2, 'vao para a lixeira');

  const discarded = await call('POST', `/centros-custo/${id}/descartar`, admin, { confirmar: 'LIMPA-1' });
  assert.equal(discarded.status, 200, JSON.stringify(discarded.data));
});
