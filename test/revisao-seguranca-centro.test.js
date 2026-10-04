// Revisao de seguranca do Centro: integracao com o Orcamentos (sessao x chave de servico), anexos,
// restauracao de copia, CSV, espelho de contas do diretorio e revalidacao de sessao.
// As permissoes das rotas de sincronizacao, historico, update e appearance ficam em permissions-routes.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-revisao-'));
process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;
delete process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY;

const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { createApp } = require('../server');
const { csvCell, csvLine } = require('../lib/csv');
const { integrationRequiresLoopback } = require('../routes/integracaoOrcamentos');
const { mirrorCloudUser } = require('../services/cloudUserMirror');
const cloudAuth = require('../services/cloudAuth');
const { cloudSessionAlive, resetCloudSessionCache } = require('../services/cloudSessionCheck');

const KEY = 'construtec-internal-integration-secret-2026';
let server;
let base;

test.before(async () => {
  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function call(method, url, { token, key, body } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'X-Construtec-Integration-Key': key } : {}),
    },
    body: method === 'GET' || (method === 'DELETE' && !body) ? undefined : JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(email, senha) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, senha } });
  assert.equal(status, 200);
  return data.token;
}

async function userWithRole(adminToken, role, { allCostCenters = true } = {}) {
  const email = `${role}-${Math.random().toString(36).slice(2, 8)}@teste.local`;
  const created = await call('POST', '/usuarios', {
    token: adminToken, body: { nome: role, email, senha: `senha-${role}-123`, role: role === 'gestor' ? 'gestor' : 'supervisor' },
  });
  assert.equal(created.status, 201);
  await getDb().query('UPDATE users SET suite_role=$1, all_cost_centers=$2 WHERE email=$3', [role, allCostCenters, email]);
  const id = (await getDb().query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  return { id, token: await login(email, `senha-${role}-123`) };
}

test('integracao com o Orcamentos: leituras por sessao exigem p10 e obra; a chave de servico segue valendo', async () => {
  const admin = await login('admin@teste.local', 'senha-teste-123');
  const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'proposal-approved.v1.example.json'), 'utf8'));
  const imported = await call('POST', '/integracao/orcamentos/confirmar-direto', { token: admin, body: envelope });
  assert.ok([200, 201].includes(imported.status));
  const contractId = imported.data.contractId;
  const costCenterId = imported.data.costCenterId;
  const importId = (await getDb().query('SELECT id FROM budget_imports WHERE contract_id=$1', [contractId])).rows[0].id;
  const base_ = '/integracao/orcamentos';
  const leituras = [`${base_}/portfolio-summary`, `${base_}/contratos/${contractId}/resumo`,
    `${base_}/contratos/${contractId}/baselines`, `${base_}/importacoes/${importId}`];

  // Chave de servico (Orcamentos): caminho preservado.
  for (const url of leituras) assert.equal((await call('GET', url, { key: KEY })).status, 200, `chave em ${url}`);
  assert.equal((await call('GET', leituras[0], { key: 'x'.repeat(40) })).status, 401);

  // Sessao de usuario sem p10 (financeiro): 403 em todas.
  const financeiro = await userWithRole(admin, 'financeiro');
  for (const url of leituras) assert.equal((await call('GET', url, { token: financeiro.token })).status, 403, `financeiro em ${url}`);

  // Papeis com p10 (gestor, comercial, admin) continuam lendo.
  const comercial = await userWithRole(admin, 'comercial');
  for (const url of leituras) {
    assert.equal((await call('GET', url, { token: comercial.token })).status, 200, `comercial em ${url}`);
    assert.equal((await call('GET', url, { token: admin })).status, 200, `admin em ${url}`);
  }

  // Engenharia com obras restritas: sem a obra, nada; o resumo agregado de todas as obras fica bloqueado.
  const engenharia = await userWithRole(admin, 'engenharia', { allCostCenters: false });
  for (const url of leituras) assert.equal((await call('GET', url, { token: engenharia.token })).status, 403, `engenharia sem obra em ${url}`);
  await getDb().query('INSERT INTO user_cost_centers (user_id,cost_center_id) VALUES ($1,$2)', [engenharia.id, costCenterId]);
  for (const url of leituras.slice(1)) assert.equal((await call('GET', url, { token: engenharia.token })).status, 200, `engenharia com a obra em ${url}`);
  assert.equal((await call('GET', leituras[0], { token: engenharia.token })).status, 403, 'portfolio nao tem filtro por obra');
});

test('chave de integracao padrao exige loopback no modo local, salvo desligar com false explicito', () => {
  const saved = { db: process.env.DATABASE_URL, flag: process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY };
  const restore = () => {
    if (saved.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.db;
    if (saved.flag === undefined) delete process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY; else process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY = saved.flag;
  };
  try {
    delete process.env.DATABASE_URL;
    delete process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY;
    assert.equal(integrationRequiresLoopback(), true, 'padrao local exige loopback');
    process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY = 'false';
    assert.equal(integrationRequiresLoopback(), false);
    process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY = '0';
    assert.equal(integrationRequiresLoopback(), true, 'so o false explicito desliga');
    process.env.DATABASE_URL = 'postgres://x';
    delete process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY;
    assert.equal(integrationRequiresLoopback(), false, 'na nuvem o trafego vem do Worker e a chave e forte');
    process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY = 'true';
    assert.equal(integrationRequiresLoopback(), true);
  } finally { restore(); }
});

test('CSV neutraliza formulas sem estragar numeros', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+cmd|calc'), "'+cmd|calc");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\t=1'), "'\t=1");
  assert.equal(csvCell('-1.234,56'), '-1.234,56');
  assert.equal(csvCell('-50'), '-50');
  assert.equal(csvCell(-50), '-50');
  assert.equal(csvCell('Compra normal'), 'Compra normal');
  assert.equal(csvCell(null), '');
  assert.equal(csvLine(['a', '=1+1', '-3,00']), "a;'=1+1;-3,00");
});

test('anexos: envio exige p2 ou p3, excluido some e remocao respeita competencia fechada', async () => {
  const admin = await login('admin@teste.local', 'senha-teste-123');
  const center = await call('POST', '/centros-custo', { token: admin, body: { codigo: 'RS-001', nome: 'Obra RS', orcamento: 1000, situacao: 'execucao' } });
  assert.equal(center.status, 201);
  const categories = await call('GET', '/categorias', { token: admin });
  const material = categories.data.find((item) => item.nome === 'Material');
  const launch = async (descricao) => (await call('POST', '/lancamentos', { token: admin, body: {
    tipo: 'despesa', data: '2026-07-20', cost_center_id: center.data.id, category_id: material.id, descricao, valor: 10,
    status_financeiro: 'liquidado', data_liquidacao: '2026-07-20',
  } })).data;
  const keep = await launch('Compra que fica');
  const drop = await launch('Compra que sera excluida');
  const upload = (token, id, texto) => call('POST', `/anexos/lancamento/${id}`, { token, body: {
    nome: 'comprovante.pdf', tipo: 'application/pdf', categoria: 'comprovante',
    conteudoBase64: Buffer.from(`%PDF-1.4\n${texto}\n%%EOF\n`).toString('base64'),
  } });

  // Sem p2 nem p3 (comercial): 403. Com p2 (tecnico): passa.
  const comercial = await userWithRole(admin, 'comercial');
  assert.equal((await upload(comercial.token, keep.id, 'a')).status, 403);
  const tecnico = await userWithRole(admin, 'tecnico');
  await getDb().query('INSERT INTO user_cost_centers (user_id,cost_center_id) VALUES ($1,$2)', [tecnico.id, center.data.id]);
  await getDb().query('UPDATE users SET all_cost_centers=FALSE WHERE id=$1', [tecnico.id]);
  assert.equal((await upload(tecnico.token, keep.id, 'b')).status, 201);
  const kept = await upload(admin, keep.id, 'c');
  assert.equal(kept.status, 201);
  const dropped = await upload(admin, drop.id, 'd');
  assert.equal(dropped.status, 201);

  // Lancamento excluido: o arquivo deixa de ser servido.
  assert.equal((await fetch(`${base}/anexos/${dropped.data.id}/arquivo`, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  assert.equal((await call('DELETE', `/lancamentos/${drop.id}`, { token: admin })).status, 200);
  assert.equal((await fetch(`${base}/anexos/${dropped.data.id}/arquivo`, { headers: { Authorization: `Bearer ${admin}` } })).status, 404);
  assert.equal((await call('DELETE', `/anexos/${dropped.data.id}`, { token: admin })).status, 404);

  // Competencia fechada: nao remove o documento; reaberta, remove.
  const closed = await call('POST', '/fechamento-mensal', { token: admin, body: { ano: 2026, mes: 7 } });
  assert.ok([200, 201].includes(closed.status), JSON.stringify(closed.data));
  const blocked = await call('DELETE', `/anexos/${kept.data.id}`, { token: admin });
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.erro, /competência está fechada/);
  const closingId = (await getDb().query('SELECT id FROM monthly_closings WHERE year=2026 AND month=7')).rows[0].id;
  assert.equal((await call('DELETE', `/fechamento-mensal/${closingId}`, { token: admin, body: { motivo: 'Reaberto para o teste de anexos' } })).status, 200);
  assert.equal((await call('DELETE', `/anexos/${kept.data.id}`, { token: admin })).status, 200);
});

test('restaurar copia guardada confere o .sha256 antes de agendar', async () => {
  const admin = await login('admin@teste.local', 'senha-teste-123');
  const feita = await call('POST', '/backup/copias', { token: admin });
  assert.equal(feita.status, 201);
  const arquivo = path.join(require('../services/autoBackup').autoBackupDir(), feita.data.copia.nome);
  fs.writeFileSync(`${arquivo}.sha256`, `${'0'.repeat(64)}  ${feita.data.copia.nome}\n`);
  const recusada = await call('POST', '/backup/restaurar', { token: admin, body: { confirmacao: 'RESTAURAR', copia: feita.data.copia.nome } });
  assert.equal(recusada.status, 400);
  assert.match(recusada.data.erro, /checksum registrado/);
  assert.equal(fs.existsSync(path.join(process.env.RESTORE_ROOT_DIR, 'restauracao-pendente.json')), false, 'nada foi agendado');
  // Com o .sha256 correto, o fluxo legitimo continua.
  fs.writeFileSync(`${arquivo}.sha256`, `${feita.data.copia.sha256}  ${feita.data.copia.nome}\n`);
  const aceita = await call('POST', '/backup/restaurar', { token: admin, body: { confirmacao: 'RESTAURAR', copia: feita.data.copia.nome } });
  assert.equal(aceita.status, 200);
  fs.rmSync(path.join(process.env.RESTORE_ROOT_DIR, 'restauracao-pendente.json'), { force: true });
});

test('espelho: conta nova sem papel da Suite nasce sem acesso a todas as obras (falha fechada)', async () => {
  const db = getDb();
  const semPapel = await mirrorCloudUser(db, { id: 'cloud-rs-1', name: 'Supervisor', email: 'sup-rs@rcconstrutec.com.br', role: 'supervisor' });
  assert.equal(semPapel.all_cost_centers, false, 'supervisor sem suiteRole vira tecnico escopado');
  const gestor = await mirrorCloudUser(db, { id: 'cloud-rs-2', name: 'Gestor', email: 'gestor-rs@rcconstrutec.com.br', role: 'gestor' });
  assert.equal(gestor.all_cost_centers, true);
  const admin = await mirrorCloudUser(db, { id: 'cloud-rs-3', name: 'Adm', email: 'adm-rs@rcconstrutec.com.br', role: 'admin' });
  assert.equal(admin.all_cost_centers, true);
  const eng = await mirrorCloudUser(db, { id: 'cloud-rs-4', name: 'Eng', email: 'eng-rs@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'engenharia' });
  assert.equal(eng.all_cost_centers, false);
  assert.equal(eng.suite_role, 'engenharia');
  const fin = await mirrorCloudUser(db, { id: 'cloud-rs-5', name: 'Fin', email: 'fin-rs@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'financeiro' });
  assert.equal(fin.all_cost_centers, true);
  // Conta antiga: espelhar de novo nao muda o escopo ja definido pelo administrador.
  await db.query('UPDATE users SET all_cost_centers=TRUE WHERE id=$1', [semPapel.id]);
  const depois = await mirrorCloudUser(db, { id: 'cloud-rs-1', name: 'Supervisor', email: 'sup-rs@rcconstrutec.com.br', role: 'supervisor' });
  assert.equal(depois.all_cost_centers, true);
});

test('revalidacao por hash tolera falha transitoria so de sessao ja confirmada e guarda o positivo por 60 s', async (t) => {
  const original = cloudAuth.sessionHash;
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://teste';
  resetCloudSessionCache();
  t.after(() => {
    cloudAuth.sessionHash = original;
    resetCloudSessionCache();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  });
  const failWith = (status) => async () => { const error = new Error('falha'); error.status = status; throw error; };
  let calls = 0;
  const options = { hashed: true, userId: 7 };

  cloudAuth.sessionHash = failWith(503);
  assert.equal(await cloudSessionAlive('hash-novo', options), false, 'sem historico, falha transitoria nega');
  cloudAuth.sessionHash = failWith(429);
  assert.equal(await cloudSessionAlive('hash-novo', options), false);

  cloudAuth.sessionHash = async () => { calls += 1; return { ok: true }; };
  assert.equal(await cloudSessionAlive('hash-ok', options), true);
  assert.equal(await cloudSessionAlive('hash-ok', options), true);
  assert.equal(calls, 1, 'segunda checagem veio do cache');

  // Sessao confirmada antes + queda do diretorio: nao derruba (cache ainda vale ou foi confirmada).
  cloudAuth.sessionHash = failWith(503);
  assert.equal(await cloudSessionAlive('hash-ok', options), true);
  cloudAuth.sessionHash = failWith(500);
  assert.equal(await cloudSessionAlive('hash-ok', options), true);

  // 401 derruba e nao e ressuscitado por falha posterior.
  cloudAuth.sessionHash = failWith(401);
  assert.equal(await cloudSessionAlive('hash-morto', options), false);
  cloudAuth.sessionHash = failWith(503);
  assert.equal(await cloudSessionAlive('hash-morto', options), false);
  assert.equal(await cloudSessionAlive('hash-ok', { hashed: true }), false, 'sem userId nao valida');
});
