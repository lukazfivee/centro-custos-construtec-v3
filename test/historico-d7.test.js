const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { limparAuditoria } = require('../services/audit');
const { detectarOrigem } = require('../lib/auditContext');

// Desktop novo (D7): Histórico com filtros, antes → depois, origem e CSV.
test('auditoria: segredos nunca entram no antes nem no depois', () => {
  const limpo = limparAuditoria({ nome: 'Ana', senha: 'x', password_hash: 'y', token: 'z', aninhado: { apiKey: 'k', ok: 1 }, lista: [{ authorization: 'a', v: 2 }] });
  assert.deepEqual(limpo, { nome: 'Ana', aninhado: { ok: 1 }, lista: [{ v: 2 }] });
  assert.equal(limparAuditoria(null), null);
});

test('origem da ação: computador, celular por x-client, user agent ou página do celular', () => {
  const req = (headers) => ({ get: (nome) => headers[nome.toLowerCase()] || '' });
  assert.equal(detectarOrigem(req({})), 'computador');
  assert.equal(detectarOrigem(req({ 'x-client': 'suite-android/1.2' })), 'celular');
  assert.equal(detectarOrigem(req({ 'user-agent': 'Mozilla/5.0 SuiteConstrutec/2.0' })), 'celular');
  assert.equal(detectarOrigem(req({ referer: 'http://localhost:3333/m/' })), 'celular');
  assert.equal(detectarOrigem(req({ referer: 'http://localhost:3333/d/' })), 'computador');
});

test('D7: tela Histórico registrada e carregada pelo index do desktop', () => {
  const raiz = path.join(__dirname, '..', 'public', 'd');
  const index = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  for (const nome of ['historico', 'historico-detalhe', 'historico-dados']) assert.ok(index.includes(`telas/${nome}.js`), `${nome}.js fora do index`);
  assert.ok(index.includes('css/historico.css'));
  assert.ok(fs.readFileSync(path.join(raiz, 'telas', 'historico.js'), 'utf8').includes("D.tela('historico'"));
});

test('histórico: filtros, antes → depois, origem, CSV e 403', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-d7-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function chamar(url, { method = 'GET', body, token, headers = {}, status } = {}) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await response.text();
    let data = texto; try { data = JSON.parse(texto); } catch { /* CSV */ }
    if (status) assert.equal(response.status, status, texto);
    return { data, response };
  }
  const entrar = async (email, senha) => (await chamar('/auth/login', { method: 'POST', body: { email, senha }, status: 200 })).data.token;
  const admin = await entrar('admin@teste.local', 'senha-teste-123');
  await chamar('/usuarios', { method: 'POST', token: admin, status: 201, body: { nome: 'Técnico Hist', email: 'tec@teste.local', senha: 'senha-tec-12345', role: 'supervisor' } });
  const { rows: [tec] } = await getDb().query("SELECT id FROM users WHERE email='tec@teste.local'");
  await getDb().query("UPDATE users SET suite_role='tecnico' WHERE id=$1", [tec.id]);
  const tecnico = await entrar('tec@teste.local', 'senha-tec-12345');

  const categoria = (await chamar('/categorias', { token: admin, status: 200 })).data.find((c) => c.tipo === 'despesa').id;
  const obra = (await chamar('/centros-custo', { method: 'POST', token: admin, status: 201, body: { codigo: 'H-001', nome: 'Obra Histórico', orcamento: 0, situacao: 'execucao' } })).data.id;
  const lanc = { tipo: 'despesa', cost_center_id: obra, category_id: categoria, descricao: 'Cimento', valor: 100, data: '2026-09-10', status_financeiro: 'pendente' };
  const criado = (await chamar('/lancamentos', { method: 'POST', token: admin, status: 201, body: lanc })).data;
  const celular = (await chamar('/lancamentos', { method: 'POST', token: admin, status: 201, headers: { 'x-client': 'suite-android/1.0' }, body: { ...lanc, descricao: 'Areia' } })).data;
  const fila = (await chamar('/lancamentos', { method: 'POST', token: admin, status: 201, headers: { 'x-client': 'suite-android/1.0' }, body: { ...lanc, descricao: 'Brita', client_id: crypto.randomUUID() } })).data;
  assert.ok(celular.id && fila.id);

  await context.test('antes → depois na edição e origem gravada', async () => {
    const atual = (await chamar(`/lancamentos/${criado.id}`, { token: admin, status: 200 })).data;
    await chamar(`/lancamentos/${criado.id}`, { method: 'PUT', token: admin, status: 200, body: { ...lanc, descricao: 'Cimento CP-II', valor: 150, revisao: atual.revision } });
    const { data } = await chamar('/historico?pagina=1&limite=50&tipo=lancamentos', { token: admin, status: 200 });
    const edicao = data.itens.find((i) => i.acao === 'atualizado');
    assert.equal(edicao.antes.description, 'Cimento');
    assert.equal(Number(edicao.antes.amount), 100);
    assert.equal(edicao.data.description, 'Cimento CP-II');
    assert.equal(edicao.origem, 'computador');
    assert.equal(edicao.lancamento_id, criado.id, 'o Abrir lançamento precisa do id numérico');
    const origens = Object.fromEntries(data.itens.filter((i) => i.acao === 'criado').map((i) => [i.resumo, i.origem]));
    assert.equal(origens['Lançamento criado: Cimento'], 'computador');
    assert.equal(origens['Lançamento criado: Areia'], 'celular');
    assert.equal(origens['Lançamento criado: Brita'], 'fila');
    assert.equal(data.paginacao.total, data.itens.length);
  });

  await context.test('usuário editado grava o antes sem senha, token ou hash', async () => {
    await chamar(`/usuarios/${tec.id}`, { method: 'PUT', token: admin, status: 200, body: { nome: 'Técnico Renomeado', email: 'tec@teste.local', role: 'supervisor' } });
    const { data } = await chamar('/historico?tipo=usuarios&pagina=1', { token: admin, status: 200 });
    const edicao = data.itens.find((i) => i.acao === 'atualizado');
    assert.equal(edicao.antes.name, 'Técnico Hist');
    assert.equal(edicao.data.name, 'Técnico Renomeado');
    const bruto = JSON.stringify(data.itens);
    assert.ok(!/senha-tec|password|hash|\$2[aby]\$/i.test(bruto), 'nada de segredo no histórico');
    const gravado = await getDb().query("SELECT before::text AS b, data::text AS d FROM audit_log WHERE entity_type='usuario'");
    for (const linha of gravado.rows) assert.ok(!/password|senha|hash|token/i.test(`${linha.b}${linha.d}`));
  });

  await context.test('fechamento reaberto fica no grupo Fechamento com o motivo', async () => {
    const f = await chamar('/fechamento-mensal', { method: 'POST', token: admin, status: 201, body: { ano: 2025, mes: 3 } });
    assert.ok(f.data.ok);
    const lista = (await chamar('/fechamento-mensal', { token: admin, status: 200 })).data;
    const id = (Array.isArray(lista) ? lista : lista.itens || []).find((x) => Number(x.year ?? x.ano) === 2025).id;
    await chamar(`/fechamento-mensal/${id}`, { method: 'DELETE', token: admin, status: 200, body: { motivo: 'Correção de lançamento esquecido' } });
    const { data } = await chamar('/historico?tipo=fechamento&pagina=1', { token: admin, status: 200 });
    assert.deepEqual(data.itens.map((i) => i.acao).sort(), ['fechado', 'reaberto']);
    assert.match(data.itens.find((i) => i.acao === 'reaberto').data.motivo, /Correção/);
  });

  await context.test('filtros: pessoa, período, busca e tipo', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const porId = (await chamar(`/historico?pagina=1&usuario=${tec.id}`, { token: admin, status: 200 })).data;
    assert.equal(porId.itens.length, 0, 'o técnico não fez nada ainda');
    const admins = (await chamar('/historico?pagina=1&usuario=Administrador', { token: admin, status: 200 })).data;
    assert.ok(admins.paginacao.total > 0);
    const pessoas = (await chamar('/historico/pessoas', { token: admin, status: 200 })).data;
    assert.ok(pessoas.length >= 1 && pessoas[0].id && pessoas[0].nome);
    const futuro = (await chamar('/historico?pagina=1&de=2999-01-01', { token: admin, status: 200 })).data;
    assert.equal(futuro.itens.length, 0);
    const passado = (await chamar('/historico?pagina=1&ate=2000-01-01', { token: admin, status: 200 })).data;
    assert.equal(passado.itens.length, 0);
    const hojeLista = (await chamar(`/historico?pagina=1&de=${hoje}&ate=${hoje}&busca=Brita`, { token: admin, status: 200 })).data;
    assert.equal(hojeLista.itens.length, 1);
    const cad = (await chamar('/historico?pagina=1&tipo=cadastros&limite=200', { token: admin, status: 200 })).data;
    assert.ok(cad.itens.every((i) => ['categoria', 'fornecedor', 'obra'].includes(i.tipo)));
    const todos = (await chamar('/historico?pagina=1&tipo=todos', { token: admin, status: 200 })).data;
    assert.ok(todos.paginacao.total > cad.paginacao.total);
    const pag = (await chamar('/historico?pagina=2&limite=2', { token: admin, status: 200 })).data;
    assert.equal(pag.itens.length, 2);
    assert.equal(pag.paginacao.pagina, 2);
  });

  await context.test('validação das datas e da paginação', async () => {
    assert.match((await chamar('/historico?de=31-12-2026', { token: admin, status: 400 })).data.erro, /Data inicial/);
    assert.match((await chamar('/historico?ate=2026-02-30', { token: admin, status: 400 })).data.erro, /Data final/);
    assert.match((await chamar('/historico?de=2026-09-10&ate=2026-09-01', { token: admin, status: 400 })).data.erro, /depois da final/);
    await chamar('/historico?pagina=0', { token: admin, status: 400 });
    await chamar('/historico/exportar.csv?de=abc', { token: admin, status: 400 });
  });

  await context.test('exportar CSV com os mesmos filtros', async () => {
    const { data, response } = await chamar('/historico/exportar.csv?tipo=lancamentos&busca=Brita', { token: admin, status: 200 });
    assert.match(response.headers.get('content-type'), /text\/csv/);
    assert.match(response.headers.get('content-disposition'), /historico\.csv/);
    const linhas = data.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(linhas[0], 'Quando;Usuário;Ação;Tipo;Registro;Resumo;Origem;Antes;Depois');
    assert.equal(linhas.length, 2);
    assert.ok(linhas[1].includes('Brita') && linhas[1].includes(';fila;'));
    assert.ok(!data.includes('Areia'));
  });

  await context.test('403 para quem só vê obras atribuídas e 401 sem login', async () => {
    await getDb().query('UPDATE users SET all_cost_centers=FALSE WHERE id=$1', [tec.id]);
    await getDb().query('INSERT INTO user_cost_centers(user_id,cost_center_id) VALUES($1,$2)', [tec.id, obra]);
    for (const rota of ['/historico', '/historico/exportar.csv', '/historico/pessoas']) {
      const r = await chamar(rota, { token: tecnico, status: 403 });
      assert.match(r.data.erro, /permissão/);
    }
    await chamar('/historico', { status: 401 });
  });
});
