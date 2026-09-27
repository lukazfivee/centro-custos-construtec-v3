const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Centro (Express) da Fase 4: avisos diários, aviso de proposta aprovada e a
// central do site do celular, com um Worker central de mentira.
test('notificações do Centro de Custos', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-notificacoes-'));
  const calls = [];
  const fakeWorker = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ path: req.url, key: req.headers['x-sync-key'], body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body.action === 'list' ? { ok: true, unread: 1, items: [] } : { ok: true, created: 1 }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => fakeWorker.once('listening', resolve));
  Object.assign(process.env, {
    DATABASE_URL: '', PGLITE_DATA_DIR: path.join(tempRoot, 'database'), RESTORE_ROOT_DIR: path.join(tempRoot, 'restore'),
    JWT_SECRET: 'notificacoes-test-secret-at-least-32-chars', ADMIN_INITIAL_PASSWORD: 'notif-test-123', ADMIN_INITIAL_EMAIL: 'notif@teste.local',
    SYNC_API_URL: `http://127.0.0.1:${fakeWorker.address().port}`, SYNC_SHARED_KEY: 's'.repeat(40),
  });
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  const { computeDailyNotices, brasiliaDates } = require('../services/dailyNotices');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeWorker.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, { method = 'GET', body, token, headers = {} } = {}) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  const token = (await request('/auth/login', { method: 'POST', body: { email: 'notif@teste.local', senha: 'notif-test-123' } })).data.token;

  let imported;
  await context.test('proposta importada avisa todos com link para a obra', async () => {
    const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/proposal-approved.v1.example.json'), 'utf8'));
    const preview = await request('/integracao/orcamentos/previas', { method: 'POST', token, body: envelope });
    const confirmed = await request(`/integracao/orcamentos/previas/${preview.data.previewId}/confirmar`, { method: 'POST', token, body: { hash: preview.data.hash } });
    assert.equal(confirmed.status, 201);
    imported = confirmed.data;
    const notice = calls.find((c) => c.path === '/v1/internal/notify' && c.body.type === 'proposta_aprovada');
    assert.ok(notice, 'aviso enviado ao Worker');
    assert.equal(notice.key, process.env.SYNC_SHARED_KEY);
    assert.equal(notice.body.audience, 'all');
    assert.equal(notice.body.link, `centro-custos?obra=${confirmed.data.costCenterId}`);
    assert.match(notice.body.body, /PA-1001 virou a obra/);
  });

  await context.test('contas de hoje e amanhã viram um aviso por dia', async () => {
    const { today, tomorrow } = brasiliaDates();
    const categories = (await request('/categorias', { token })).data;
    const material = categories.find((item) => item.nome === 'Material');
    const center = (await getDb().query('SELECT id FROM cost_centers ORDER BY id LIMIT 1')).rows[0];
    for (const [vencimento, valor] of [[today, 100], [today, 50.5], [tomorrow, 20]]) {
      const created = await request('/lancamentos', { method: 'POST', token, body: { tipo: 'despesa', data: today, vencimento, cost_center_id: center.id, category_id: material.id, descricao: 'Conta a vencer', valor, status_financeiro: 'pendente' } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
    }
    const events = await computeDailyNotices(getDb());
    const bills = events.find((e) => e.type === 'conta_vencer');
    assert.equal(bills.dedupeKey, `contas:${today}`);
    assert.match(bills.body, /2 contas vencem hoje \(R\$\s?150,50\) e 1 vence amanhã \(R\$\s?20,00\)/);
  });

  await context.test('item acima do orcado gera aviso por item, com link para a obra', async () => {
    const comparison = (await request(`/centros-custo/${imported.costCenterId}/orcado-realizado`, { token })).data;
    const item = comparison.items.find((i) => i.kind === 'material') || comparison.items[0];
    const category = (await request('/categorias', { token })).data[0];
    const tx = await request('/lancamentos', { method: 'POST', token, body: { tipo: 'despesa', cost_center_id: imported.costCenterId, category_id: category.id, descricao: 'Porcelanato extra', valor: item.budgetedCost + 500, data: '2026-09-06', status_financeiro: 'liquidado' } });
    const alloc = await request(`/centros-custo/${imported.costCenterId}/apropriacoes`, { method: 'POST', token, body: { transactionId: tx.data.id, amount: item.budgetedCost + 500, contractId: imported.contractId, controlItemId: item.controlItemId, quantity: 1, unit: item.unit } });
    assert.equal(alloc.status, 201, JSON.stringify(alloc.data));
    const events = await computeDailyNotices(getDb());
    const over = events.find((e) => e.type === 'acima_orcado');
    assert.ok(over, JSON.stringify(events));
    assert.equal(over.link, `centro-custos?obra=${imported.costCenterId}`);
    assert.equal(over.dedupeKey, `orcado:${imported.costCenterId}:${item.controlItemId}`);
    assert.match(over.body, /passou R\$\s?500,00 do orçado/);
  });

  await context.test('rota interna exige a chave e a central exige conta central', async () => {
    assert.equal((await request('/interno/avisos-diarios', { method: 'POST' })).status, 404);
    const daily = await request('/interno/avisos-diarios', { method: 'POST', headers: { 'x-sync-key': process.env.SYNC_SHARED_KEY } });
    assert.equal(daily.status, 200);
    assert.ok(daily.data.events.some((e) => e.type === 'conta_vencer'));
    assert.equal((await request('/notificacoes', { token })).status, 409);
    await getDb().query("UPDATE users SET cloud_user_id='conta-central-1' WHERE email='notif@teste.local'");
    const listed = await request('/notificacoes', { token });
    assert.equal(listed.status, 200);
    assert.deepEqual(calls.at(-1).body, { action: 'list', userId: 'conta-central-1' });
    assert.equal((await request('/notificacoes/preferencias', { method: 'PUT', token, body: { tipo: 'x', ativo: true } })).status, 400);
    await request('/notificacoes/lidas', { method: 'POST', token, body: { todas: true } });
    assert.deepEqual(calls.at(-1).body, { all: true, action: 'read', userId: 'conta-central-1' });
  });
});
