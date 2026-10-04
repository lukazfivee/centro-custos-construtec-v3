// Pendencias da revisao de seguranca de 04/10/2026 no Express do Centro: A4 (IP real ao Worker),
// M1 (apps da conta), M4 (fornecedores por obra), M5 (medicao so em contrato da obra) e M8 (bloqueio de login).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-pendencias-'));
process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { createApp } = require('../server');
const cloudAuth = require('../services/cloudAuth');
const { createLoginThrottle } = require('../lib/loginThrottle');

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

async function call(method, url, { token, body, headers } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(email, senha) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, senha } });
  assert.equal(status, 200, JSON.stringify(data));
  return data.token;
}

// O login na nuvem so se comporta como tal com DATABASE_URL definido; liga so durante a chamada.
async function cloudLogin(email, senha, headers) {
  process.env.DATABASE_URL = 'postgres://somente-para-o-teste';
  try { return await call('POST', '/auth/login', { body: { email, senha }, headers }); } finally { delete process.env.DATABASE_URL; }
}

async function withMockedLogin(fn, impl) {
  const original = cloudAuth.login;
  cloudAuth.login = impl;
  try { return await fn(); } finally { cloudAuth.login = original; }
}

const recusa = async () => { const error = new Error('E-mail ou senha invalidos.'); error.status = 401; throw error; };

async function adminToken() { return login('admin@teste.local', 'senha-teste-123'); }

async function localUser(admin, email, role = 'gestor') {
  const created = await call('POST', '/usuarios', { token: admin, body: { nome: email, email, senha: 'senha-pendencia-123', role } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return (await getDb().query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
}

// ---- A4: o Express repassa o IP real ao Worker ----

test('A4: login repassa o IP real com a chave de servico e o app; sem a chave nao envia nada', async () => {
  const saved = { fetch: global.fetch, key: process.env.CONSTRUTEC_IDENTITY_KEY, url: process.env.SYNC_API_URL };
  const seen = [];
  global.fetch = async (url, options) => { seen.push({ url, headers: options.headers }); return Response.json({ ok: true, user: {}, sessionToken: 't' }); };
  process.env.SYNC_API_URL = 'https://worker.test';
  try {
    process.env.CONSTRUTEC_IDENTITY_KEY = `﻿${'k'.repeat(40)}\n`;
    await cloudAuth.login('a@rcconstrutec.com.br', 'x', { ip: '203.0.113.50' });
    assert.equal(seen[0].url, 'https://worker.test/v1/auth/login');
    assert.equal(seen[0].headers['x-construtec-identity-key'], 'k'.repeat(40));
    assert.equal(seen[0].headers['x-construtec-client-ip'], '203.0.113.50');
    assert.equal(seen[0].headers['x-construtec-app'], 'centro');

    await cloudAuth.login('a@rcconstrutec.com.br', 'x');
    assert.equal(seen[1].headers['x-construtec-identity-key'], undefined, 'sem IP nao ha o que repassar');

    process.env.CONSTRUTEC_IDENTITY_KEY = 'curta';
    await cloudAuth.login('a@rcconstrutec.com.br', 'x', { ip: '203.0.113.50' });
    assert.equal(seen[2].headers['x-construtec-identity-key'], undefined, 'chave curta nao e enviada');
    delete process.env.CONSTRUTEC_IDENTITY_KEY;
    await cloudAuth.login('a@rcconstrutec.com.br', 'x', { ip: '203.0.113.50' });
    assert.equal(seen[3].headers['x-construtec-client-ip'], undefined);
  } finally {
    global.fetch = saved.fetch;
    for (const [name, value] of [['CONSTRUTEC_IDENTITY_KEY', saved.key], ['SYNC_API_URL', saved.url]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('A4: a rota de login entrega ao Worker o IP de borda da Cloudflare (so na nuvem)', async () => {
  const ips = [];
  await withMockedLogin(async () => {
    await cloudLogin('ip-nuvem@rcconstrutec.com.br', 'x', { 'cf-connecting-ip': '203.0.113.77' });
    // No desktop o cabecalho nao e confiavel: vale o endereco da conexao (loopback).
    await call('POST', '/auth/login', { body: { email: 'ip-desktop@rcconstrutec.com.br', senha: 'x' }, headers: { 'cf-connecting-ip': '203.0.113.78' } });
  }, async (email, senha, options) => { ips.push(options.ip); return recusa(); });
  assert.equal(ips[0], '203.0.113.77');
  assert.match(ips[1], /127\.0\.0\.1|::1/);
});

// ---- M1: apps da conta ----

let remoteSeq = 0;
function remoteUser(email, apps) {
  remoteSeq += 1;
  return { id: `11111111-2222-3333-4444-${String(remoteSeq).padStart(12, '0')}`, name: 'Pessoa', email, role: 'supervisor', suiteRole: 'tecnico', ...(apps ? { apps } : {}), active: true };
}

test('M1: login do Centro recusa quem nao tem o app centro, com mensagem clara; sem apps definido entra', async () => {
  const sem = await withMockedLogin(() => cloudLogin('so-orc@rcconstrutec.com.br', 'x'),
    async () => ({ user: remoteUser('so-orc@rcconstrutec.com.br', ['orcamentos']), sessionToken: 'tok-1' }));
  assert.equal(sem.status, 403);
  assert.match(sem.data.erro, /não tem acesso ao Centro de Custos/);

  const antiga = await withMockedLogin(() => cloudLogin('antiga@rcconstrutec.com.br', 'x'),
    async () => ({ user: remoteUser('antiga@rcconstrutec.com.br'), sessionToken: 'tok-2' }));
  assert.equal(antiga.status, 200);

  const com = await withMockedLogin(() => cloudLogin('com-centro@rcconstrutec.com.br', 'x'),
    async () => ({ user: remoteUser('com-centro@rcconstrutec.com.br', ['centro', 'orcamentos']), sessionToken: 'tok-3' }));
  assert.equal(com.status, 200);

  // O Worker tambem recusa (APP_NOT_ALLOWED): a mensagem dele chega ao usuario.
  const worker = await withMockedLogin(() => cloudLogin('worker@rcconstrutec.com.br', 'x'), async () => {
    const error = new Error('Sua conta não tem acesso ao Centro de Custos. Peça a um administrador para liberar.');
    error.status = 403; error.code = 'APP_NOT_ALLOWED'; throw error;
  });
  assert.equal(worker.status, 403);
  assert.match(worker.data.erro, /Centro de Custos/);
});

test('M1: sessao ja emitida deixa de valer quando o app centro e retirado; conta antiga e local seguem', async () => {
  const admin = await adminToken();
  const id = await localUser(admin, 'apps-local@teste.local');
  const token = await login('apps-local@teste.local', 'senha-pendencia-123');
  assert.equal((await call('GET', '/auth/me', { token })).status, 200);

  await getDb().query(`UPDATE users SET apps='["orcamentos"]' WHERE id=$1`, [id]);
  const bloqueada = await call('GET', '/auth/me', { token });
  assert.equal(bloqueada.status, 403);
  assert.match(bloqueada.data.erro, /Centro de Custos/);
  const novoLogin = await call('POST', '/auth/login', { body: { email: 'apps-local@teste.local', senha: 'senha-pendencia-123' } });
  assert.equal(novoLogin.status, 403);

  await getDb().query('UPDATE users SET apps=NULL WHERE id=$1', [id]);
  assert.equal((await call('GET', '/auth/me', { token })).status, 200, 'ausencia de apps = todos');
  await getDb().query(`UPDATE users SET apps='["centro"]' WHERE id=$1`, [id]);
  assert.equal((await call('GET', '/auth/me', { token })).status, 200);
});

test('M1: a ponte do handoff recusa conta sem o app centro', async () => {
  const saved = process.env.SYNC_SHARED_KEY;
  process.env.SYNC_SHARED_KEY = 'h'.repeat(40);
  process.env.DATABASE_URL = 'postgres://somente-para-o-teste';
  try {
    const bridge = (apps) => call('POST', '/auth/handoff-bridge', {
      headers: { 'x-sync-key': process.env.SYNC_SHARED_KEY },
      body: { sessionHash: 'a'.repeat(64), user: remoteUser('ponte@rcconstrutec.com.br', apps) },
    });
    assert.equal((await bridge(['orcamentos'])).status, 403);
    assert.equal((await bridge(['centro'])).status, 200);
    assert.equal((await bridge(undefined)).status, 200);
  } finally {
    delete process.env.DATABASE_URL;
    if (saved === undefined) delete process.env.SYNC_SHARED_KEY; else process.env.SYNC_SHARED_KEY = saved;
  }
});

// ---- M4: fornecedores por obra ----

test('M4: lista e painel de fornecedor somam so as obras permitidas ao usuario escopado', async () => {
  const admin = await adminToken();
  const categoria = (await call('GET', '/categorias', { token: admin })).data.find((c) => c.tipo === 'despesa').id;
  const obra = async (codigo) => (await call('POST', '/centros-custo', { token: admin, body: { codigo, nome: `Obra ${codigo}`, orcamento: 1000, situacao: 'execucao' } })).data.id;
  const [a, b] = [await obra('FOR-A'), await obra('FOR-B')];
  const fornecedor = (await call('POST', '/fornecedores', { token: admin, body: { nome: 'Fornecedor Escopo' } })).data.id;
  for (const [obraId, valor] of [[a, 100], [b, 200]]) {
    const r = await call('POST', '/lancamentos', { token: admin, body: {
      tipo: 'despesa', cost_center_id: obraId, category_id: categoria, descricao: `Compra ${valor}`, favorecido: 'Fornecedor Escopo',
      valor, data: '2026-09-15', status_financeiro: 'liquidado',
    } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const conta = async (email, role, obras, todas = false) => {
    const id = await localUser(admin, email, 'supervisor');
    await getDb().query('UPDATE users SET suite_role=$1, all_cost_centers=$2 WHERE id=$3', [role, todas, id]);
    for (const o of obras) await getDb().query('INSERT INTO user_cost_centers(user_id,cost_center_id) VALUES($1,$2)', [id, o]);
    return login(email, 'senha-pendencia-123');
  };
  const doFornecedor = (rows) => (Array.isArray(rows) ? rows : rows.itens).find((s) => s.id === fornecedor);

  const lista = async (token, query = '') => doFornecedor((await call('GET', `/fornecedores?mes=2026-09${query}`, { token })).data);
  const resumo = async (token) => (await call('GET', `/fornecedores/${fornecedor}/resumo?mes=2026-09`, { token })).data;

  // Quem ve tudo (admin e escopado com todas as obras) continua vendo a soma completa.
  const todas = await conta('forn-todas@teste.local', 'engenharia', [], true);
  for (const token of [admin, todas]) {
    assert.equal(Number((await lista(token)).gasto_mes), 300);
    assert.equal(Number((await lista(token)).lancamentos_mes), 2);
    const r = await resumo(token);
    assert.equal(r.gasto_mes, 300);
    assert.equal(r.lancamentos.length, 2);
  }
  assert.equal(Number(doFornecedor((await call('GET', '/fornecedores?mes=2026-09&pagina=1&busca=Escopo', { token: admin })).data).gasto_mes), 300);

  // Escopado na obra A: so a obra A, inclusive com busca e paginacao.
  const soA = await conta('forn-a@teste.local', 'tecnico', [a]);
  assert.equal(Number((await lista(soA)).gasto_mes), 100);
  assert.equal(Number((await lista(soA)).lancamentos_mes), 1);
  assert.equal(Number(doFornecedor((await call('GET', '/fornecedores?mes=2026-09&pagina=1&busca=Escopo', { token: soA })).data).gasto_mes), 100);
  const rA = await resumo(soA);
  assert.equal(rA.gasto_mes, 100);
  assert.equal(rA.lancamentos_mes, 1);
  assert.deepEqual(rA.lancamentos.map((l) => l.obra_codigo), ['FOR-A']);

  // Escopado sem nenhuma obra: zeros e lista vazia (o cadastro em si continua listado).
  const semObra = await conta('forn-zero@teste.local', 'engenharia', []);
  assert.equal(Number((await lista(semObra)).gasto_mes), 0);
  assert.equal(Number((await lista(semObra)).lancamentos_mes), 0);
  const rZero = await resumo(semObra);
  assert.deepEqual([rZero.gasto_mes, rZero.lancamentos_mes, rZero.lancamentos.length], [0, 0, 0]);
});

// ---- M5: medicao so em contrato da propria obra ----

test('M5: medicao com contractId de outra obra e recusada; contrato da propria obra segue valendo', async () => {
  const admin = await adminToken();
  const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'proposal-approved.v1.example.json'), 'utf8'));
  const imported = await call('POST', '/integracao/orcamentos/confirmar-direto', { token: admin, body: envelope });
  assert.ok([200, 201].includes(imported.status), JSON.stringify(imported.data));
  const { contractId, costCenterId } = imported.data;
  const outra = (await call('POST', '/centros-custo', { token: admin, body: { codigo: 'MED-OUTRA', nome: 'Outra obra', orcamento: 1000, situacao: 'execucao' } })).data.id;
  const periodo = { periodStart: '2026-03-01', periodEnd: '2026-03-07' };

  for (const payload of [
    { type: 'labor', teamHours: 5, ...periodo },
    { type: 'contract', measurementNumber: 9, measuredAmount: 10, ...periodo },
  ]) {
    for (const alheio of [contractId, 'nao-e-um-contrato']) {
      const r = await call('POST', `/centros-custo/${outra}/medicoes`, { token: admin, body: { ...payload, contractId: alheio } });
      assert.equal(r.status, 404, `${payload.type} com ${alheio}: ${JSON.stringify(r.data)}`);
    }
  }
  const nada = await call('GET', `/centros-custo/${costCenterId}/medicoes`, { token: admin });
  assert.equal(nada.data.labor.length, 0);
  assert.equal(nada.data.contracts.length, 0);

  // Fluxo legitimo: contractId explicito da propria obra, e sem contractId (resolvido pela obra).
  const explicito = await call('POST', `/centros-custo/${costCenterId}/medicoes`, { token: admin, body: { type: 'labor', teamHours: 5, contractId, ...periodo } });
  assert.equal(explicito.status, 201, JSON.stringify(explicito.data));
  const implicito = await call('POST', `/centros-custo/${costCenterId}/medicoes`, { token: admin, body: { type: 'contract', measurementNumber: 1, measuredAmount: 10, ...periodo } });
  assert.equal(implicito.status, 201, JSON.stringify(implicito.data));
});

// ---- M8: bloqueio de login por e-mail + IP, com teto global por e-mail ----

test('M8: 5 falhas bloqueiam so aquele e-mail naquele IP; outro IP segue podendo tentar', async () => {
  await withMockedLogin(async () => {
    const tenta = (ip) => cloudLogin('vitima@teste.local', 'errada', { 'cf-connecting-ip': ip });
    for (let i = 0; i < 5; i += 1) assert.equal((await tenta('198.51.100.10')).status, 401);
    const bloqueado = await tenta('198.51.100.10');
    assert.equal(bloqueado.status, 429);
    assert.match(bloqueado.data.erro, /Muitas tentativas/);
    assert.equal((await tenta('198.51.100.11')).status, 401, 'um atacante em um IP nao tranca a conta para os outros');
    // Outro e-mail no IP bloqueado nao e afetado.
    assert.equal((await cloudLogin('terceiro@teste.local', 'errada', { 'cf-connecting-ip': '198.51.100.10' })).status, 401);
  }, recusa);
});

test('M8: falhas espalhadas em varios IPs estouram o limite global do e-mail', async () => {
  await withMockedLogin(async () => {
    const email = 'distribuido@teste.local';
    for (let ip = 1; ip <= 6; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        const r = await cloudLogin(email, 'errada', { 'cf-connecting-ip': `203.0.113.${ip}` });
        assert.equal(r.status, 401, `ip ${ip} tentativa ${i + 1}`);
      }
    }
    const novoIp = await cloudLogin(email, 'errada', { 'cf-connecting-ip': '203.0.113.200' });
    assert.equal(novoIp.status, 429);
  }, recusa);
});

test('M8: login correto limpa a falha do par e nao fica preso a falhas antigas', async () => {
  const admin = await adminToken();
  await localUser(admin, 'certo@teste.local');
  for (let i = 0; i < 4; i += 1) assert.equal((await call('POST', '/auth/login', { body: { email: 'certo@teste.local', senha: 'errada' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'certo@teste.local', senha: 'senha-pendencia-123' } })).status, 200);
  for (let i = 0; i < 4; i += 1) assert.equal((await call('POST', '/auth/login', { body: { email: 'certo@teste.local', senha: 'errada' } })).status, 401);
  assert.equal((await call('POST', '/auth/login', { body: { email: 'certo@teste.local', senha: 'senha-pendencia-123' } })).status, 200);
});

test('M8: o controle de falhas expira por janela, varre as vencidas e tem teto de entradas', () => {
  let agora = 1_000_000;
  const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, blockMs: 120_000, maxEntries: 4, clock: () => agora });
  throttle.fail('a'); throttle.fail('a');
  assert.equal(throttle.blockedMinutes('a'), 0);
  throttle.fail('a');
  assert.equal(throttle.blockedMinutes('a'), 2);
  agora += 119_000;
  assert.equal(throttle.blockedMinutes('a'), 1);
  agora += 2_000;
  assert.equal(throttle.blockedMinutes('a'), 0, 'bloqueio expirou');
  assert.equal(throttle.size(), 0);

  // Falhas fora da janela nao acumulam.
  throttle.fail('b'); throttle.fail('b');
  agora += 61_000;
  throttle.fail('b');
  assert.equal(throttle.blockedMinutes('b'), 0);

  // Teto: encher alem do limite descarta a mais antiga; a varredura limpa as vencidas.
  for (const key of ['c', 'd', 'e', 'f', 'g']) throttle.fail(key);
  assert.ok(throttle.size() <= 4);
  agora += 61_000;
  throttle.sweep();
  assert.equal(throttle.size(), 0);
  throttle.fail('');
  assert.equal(throttle.size(), 0, 'chave vazia nao entra');
});
