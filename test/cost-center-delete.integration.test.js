const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

test('exclusão de centro exige admin, preserva vínculos e remove apenas centro vazio', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-delete-'));
  process.env.PGLITE_DATA_DIR = path.join(root, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(root, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(url, method, token, body) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body == null ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const login = await request('/auth/login', 'POST', null, { email: 'admin@teste.local', senha: 'senha-teste-123' });
  const admin = login.data.token;
  assert.equal(login.status, 200);
  await request('/usuarios', 'POST', admin, { nome: 'Gestora', email: 'gestora@teste.local', senha: 'senha-gestora-1', role: 'gestor' });
  const users = await getDb().query("SELECT id, role FROM users WHERE email IN ('admin@teste.local','gestora@teste.local')");
  const idGestor = users.rows.find((u) => u.role === 'gestor').id;
  const idAdmin = users.rows.find((u) => u.role === 'admin').id;
  const gestor = jwt.sign({}, process.env.JWT_SECRET, { subject: String(idGestor), expiresIn: '1h' });
  const category = (await getDb().query('SELECT id FROM categories LIMIT 1')).rows[0].id;
  const smartSync = require('../services/smartSync');
  const actor = { id: idAdmin, name: 'Administrador' };
  let sequence = 0;
  async function center() {
    const code = `DEL-${++sequence}`;
    const result = await request('/centros-custo', 'POST', admin, { codigo: code, nome: `Obra ${code}` });
    assert.equal(result.status, 201);
    return result.data.id;
  }
  const empty = await center();
  const publicId = (await getDb().query('SELECT public_id FROM cost_centers WHERE id=$1', [empty])).rows[0].public_id;
  const csvResponse = await fetch(`${base}/cadastro-sync/exportar.csv`, { headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(csvResponse.status, 200);
  const oldCsv = await csvResponse.text();
  const oldPackage = await smartSync.buildPackage();
  assert.equal((await request(`/centros-custo/${empty}`, 'DELETE', null)).status, 401);
  assert.equal((await request(`/centros-custo/${empty}`, 'DELETE', gestor)).status, 403);
  assert.equal((await request(`/centros-custo/${empty}`, 'DELETE', admin)).status, 200);
  assert.equal((await request(`/centros-custo/${empty}`, 'DELETE', admin)).status, 404);
  assert.equal((await getDb().query('SELECT 1 FROM cost_center_tombstones WHERE public_id=$1', [publicId])).rows.length, 1);
  const csvImport = await request('/cadastro-sync/importar', 'POST', admin, { conteudo: oldCsv, nomeArquivo: 'anterior.csv' });
  assert.equal(csvImport.status, 200);
  assert.equal(csvImport.data.obras.ignorados, 1);
  assert.match(csvImport.data.detalhes.find((x) => x.status === 'ignorado').mensagem, /excluída nesta instalação/i);
  const smartImport = await smartSync.importPackage({ content: JSON.stringify(oldPackage), filename: 'anterior.ccsync', user: actor });
  assert.equal(smartImport.resumo.porTipo.obra.conflitos, 1);
  const conflicts = await smartSync.listConflicts();
  const centerConflict = conflicts.find((x) => x.entity_type === 'obra' && x.entity_public_id === publicId);
  assert.ok(centerConflict);
  await assert.rejects(smartSync.resolveConflict({ id: centerConflict.id, choice: 'recebido', user: actor }), (error) => error.statusCode === 409);
  await smartSync.resolveConflict({ id: centerConflict.id, choice: 'local', user: actor });
  assert.equal((await getDb().query('SELECT 1 FROM cost_centers WHERE public_id=$1', [publicId])).rows.length, 0);

  const pdf = Buffer.from('%PDF-1.4 teste');
  const vinculados = [
    ['recurring_templates', (id) => getDb().query(
      'INSERT INTO recurring_templates (name,type,cost_center_id,category_id,amount,frequency,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['Modelo', 'despesa', id, category, 10, 'mensal', idAdmin])],
    ['cost_center_invoices', (id) => getDb().query(
      'INSERT INTO cost_center_invoices (cost_center_id,original_name,size_bytes,sha256,content) VALUES ($1,$2,$3,$4,$5)',
      [id, 'nf.pdf', pdf.length, 'hash', pdf])],
    ['cost_center_proposals', (id) => getDb().query(
      'INSERT INTO cost_center_proposals (cost_center_id,original_name,size_bytes,sha256,content) VALUES ($1,$2,$3,$4,$5)',
      [id, 'proposta.pdf', pdf.length, 'hash', pdf])],
    ['cost_center_invoices_ledger', (id) => getDb().query(
      'INSERT INTO cost_center_invoices_ledger (cost_center_id,tipo,original_name,valor) VALUES ($1,$2,$3,$4)',
      [id, 'cliente', 'nf.pdf', 10])],
  ];
  for (const [table, insert] of vinculados) {
    const id = await center();
    await insert(id);
    const denied = await request(`/centros-custo/${id}`, 'DELETE', admin);
    assert.equal(denied.status, 409, table);
    assert.match(denied.data.erro, /inative/i, table);
    assert.equal((await getDb().query('SELECT 1 FROM cost_centers WHERE id=$1', [id])).rows.length, 1, table);
    assert.equal((await getDb().query(`SELECT 1 FROM ${table} WHERE cost_center_id=$1`, [id])).rows.length, 1, table);
  }
});
