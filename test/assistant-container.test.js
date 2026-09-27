const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Assistente do celular (/api/assistente): propostas do Orçamentos lidas com a
// sessão central de quem pergunta (handoff target orcamentos trocado no servidor).
function fakeServer(handler) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const out = handler(req, raw ? JSON.parse(raw) : {});
      res.writeHead(out.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body || {}));
    });
  }).listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => resolve(server)));
}

const PROPOSALS = [
  { id: 'p1', number: 'PROP-001', revision: 2, clientName: 'Hospital São Lucas', workName: 'Ala Norte', status: 'sent', itemCount: 3, totalSale: 150000.5, updatedAt: '2026-09-20T10:00:00Z', isLatest: true },
  { id: 'p0', number: 'PROP-001', revision: 1, clientName: 'Hospital São Lucas', workName: 'Ala Norte', status: 'draft', itemCount: 2, totalSale: 90000, updatedAt: '2026-09-01T10:00:00Z', isLatest: false },
  { id: 'p2', number: 'PROP-002', revision: 1, clientName: 'Escola Central', workName: 'CFTV', status: 'approved', itemCount: 5, totalSale: 42000, updatedAt: '2026-09-25T10:00:00Z', isLatest: true },
];

test('assistente: propostas do Orçamentos pelo Centro', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-assistente-'));
  const calls = { handoff: [], orc: [] };
  let expireOnce = false;
  const worker = await fakeServer((req, body) => {
    if (req.url === '/v1/auth/handoff') {
      calls.handoff.push({ auth: req.headers.authorization, body });
      return { body: { ok: true, code: `c${calls.handoff.length}`.padEnd(43, 'x') } };
    }
    return { status: 404 };
  });
  const orc = await fakeServer((req, body) => {
    calls.orc.push({ url: req.url, session: req.headers['x-construtec-session'], origin: req.headers.origin });
    if (req.url === '/api/auth/handoff') return { body: { token: `orc-${body.code.slice(0, 2)}`, user: { role: 'viewer' } } };
    if (!String(req.headers['x-construtec-session'] || '').startsWith('orc-')) return { status: 401 };
    if (expireOnce) { expireOnce = false; return { status: 401 }; }
    if (req.url === '/api/proposals') return { body: { proposals: PROPOSALS } };
    if (req.url === '/api/proposals/p1') {
      return { body: { proposal: { ...PROPOSALS[0], scope: 'Instalações elétricas', responsibleName: 'Ana', bdiMultiplier: 1.25, taxPercentage: 9,
        items: [{ description: 'Cabo 10mm', category: 'Material', quantity: 100, unit: 'm', totalCost: 800, totalSale: 1000 },
          { description: 'Quadro', category: 'Material', quantity: 1, unit: 'un', totalCost: 5000, totalSale: 7000 }],
        totals: { baseCost: 100000, finalValue: 150000.5, grossResult: 50000.5, marginPercent: 33.33 } } } };
    }
    return { status: 404 };
  });
  Object.assign(process.env, {
    DATABASE_URL: '', PGLITE_DATA_DIR: path.join(tempRoot, 'database'), RESTORE_ROOT_DIR: path.join(tempRoot, 'restore'),
    JWT_SECRET: 'assistente-test-secret-at-least-32-chars', ADMIN_INITIAL_PASSWORD: 'assistente-123', ADMIN_INITIAL_EMAIL: 'ia@teste.local',
    SYNC_API_URL: `http://127.0.0.1:${worker.address().port}`, SYNC_SHARED_KEY: 'k'.repeat(40),
    ORCAMENTOS_API_URL: `http://127.0.0.1:${orc.address().port}`,
  });
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => worker.close(resolve));
    await new Promise((resolve) => orc.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, token) => {
    const response = await fetch(base + route, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: response.status, data: await response.json().catch(() => null) };
  };
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ia@teste.local', senha: 'assistente-123' }) });
  const token = (await login.json()).token;

  assert.equal((await request('/assistente/orcamentos/propostas')).status, 401);
  // Conta local, sem sessão central: não chama o Worker.
  const local = await request('/assistente/orcamentos/propostas', token);
  assert.equal(local.status, 409);
  assert.equal(calls.handoff.length, 0);

  await getDb().query("UPDATE users SET cloud_managed=TRUE, cloud_session_token='sessao-central-teste' WHERE email='ia@teste.local'");
  const list = await request('/assistente/orcamentos/propostas', token);
  assert.equal(list.status, 200);
  assert.equal(list.data.total_encontradas, 2, 'só a revisão mais nova de cada proposta');
  assert.equal(list.data.propostas[0].id, 'p2', 'mais recente primeiro');
  assert.equal(list.data.propostas[1].status, 'enviada');
  assert.equal(list.data.soma_valor_venda, 192000.5);
  assert.deepEqual(calls.handoff[0], { auth: 'Bearer sessao-central-teste', body: { target: 'orcamentos' } });
  assert.equal(calls.orc.at(-1).origin, undefined, 'servidor a servidor, sem Origin (CORS do Orçamentos)');

  const filtered = await request('/assistente/orcamentos/propostas?busca=sao%20lucas&status=enviada', token);
  assert.deepEqual(filtered.data.propostas.map((p) => p.id), ['p1'], 'busca sem acento e status em português');
  assert.equal(calls.handoff.length, 1, 'sessão do Orçamentos reaproveitada');

  const detail = await request('/assistente/orcamentos/propostas/p1', token);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.totais.valor_final, 150000.5);
  assert.equal(detail.data.totais.margem_pct, 33.33);
  assert.equal(detail.data.itens_principais[0].descricao, 'Quadro', 'itens pelo maior valor de venda');
  assert.equal(detail.data.escopo, 'Instalações elétricas');

  // Sessão expirada no Orçamentos: pede outra uma vez e segue.
  expireOnce = true;
  assert.equal((await request('/assistente/orcamentos/propostas', token)).status, 200);
  assert.equal(calls.handoff.length, 2);

  assert.equal((await request('/assistente/orcamentos/propostas/nao-existe', token)).status, 404);
  assert.equal((await request('/assistente/orcamentos/propostas/..%2Fusers', token)).status, 400);
});
