const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('assinatura')]).toString('base64');
const jpg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]).toString('base64');

test('Servicos curtos: cadastro, gastos por tipo, campo, concluir, relatorio e tecnico sem margem', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-servicos-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'servicos-test-secret-with-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'servicos-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'servicos@teste.local';

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

  async function request(route, method = 'GET', body, status = 200, token = admin) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }
  const login = async (email, senha) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }) })).json()).token;
  const admin = await login('servicos@teste.local', 'servicos-test-123');
  await request('/usuarios', 'POST', { nome: 'Tecnico Campo', email: 'tec@teste.local', senha: 'tecnico-senha-123', role: 'supervisor' }, 201);
  const tec = await login('tec@teste.local', 'tecnico-senha-123');

  let id;
  await context.test('sugere o proximo codigo e cria o servico (so cliente e valor obrigatorios)', async () => {
    assert.equal((await request('/servicos/proximo-codigo')).codigo, 'SV-1001');
    await request('/centros-custo', 'POST', { codigo: 'SV-1013', nome: 'Antigo', tipo: 'servico' }, 201);
    assert.equal((await request('/servicos/proximo-codigo')).codigo, 'SV-1014');
    await request('/servicos', 'POST', { valor: 100 }, 400);
    await request('/servicos', 'POST', { cliente: 'Condominio Sol' }, 400);
    await request('/servicos', 'POST', { cliente: 'X', valor: 1, codigo: 'OB-9' }, 400);
    await request('/servicos', 'POST', { cliente: 'X', valor: 1, codigo: 'SV-1013' }, 409);
    await request('/servicos', 'POST', { cliente: 'X', valor: 1 }, 403, tec);
    const s = await request('/servicos', 'POST', { cliente: 'Condominio Sol', valor: 1200, local: 'Rua A, 10', data: '2026-10-02',
      responsavel: 'Carlos', descricao: 'Instalar 2 cameras na portaria' }, 201);
    id = s.id;
    assert.equal(s.codigo, 'SV-1014');
    assert.equal(s.situacao, 'agendado');
    assert.equal(s.local, 'Rua A, 10');
    assert.equal(s.valor, 1200);
    assert.equal(s.nome, 'Instalar 2 cameras na portaria');
    const cc = (await db.query('SELECT kind,contract_amount,client FROM cost_centers WHERE id=$1', [id])).rows[0];
    assert.equal(cc.kind, 'servico');
    assert.equal(Number(cc.contract_amount), 1200);
    const list = await request('/servicos?situacao=agendado');
    assert.ok(list.some((x) => x.id === id && x.valor === 1200));
    assert.ok((await db.query("SELECT 1 FROM audit_log WHERE entity_type='servico' AND action='criado'")).rows.length);
  });

  await context.test('editar e mudar situacao', async () => {
    const e = await request(`/servicos/${id}`, 'PUT', { local: 'Rua B, 20', valor: 1500 });
    assert.equal(e.local, 'Rua B, 20');
    assert.equal(e.valor, 1500);
    await request(`/servicos/${id}`, 'PUT', { revisao: 1 }, 409);
    const s = await request(`/servicos/${id}/situacao`, 'PUT', { situacao: 'em_andamento' }, 200, tec);
    assert.equal(s.situacao, 'em_andamento');
    await request(`/servicos/${id}/situacao`, 'PUT', { situacao: 'faturado' }, 400);
  });

  await context.test('lancamento rapido com recibo e resumo com gastos por tipo', async () => {
    const g1 = await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'deslocamento', valor: 42.5, descricao: 'Uber ida e volta',
      recibo: { nome: 'uber.jpg', tipo: 'image/jpeg', conteudoBase64: jpg('uber') } }, 201, tec);
    assert.ok(g1.anexoId);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'material', valor: 157.5 }, 201, tec);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'combustivel', valor: 50, data: '2026-10-03' }, 201);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'viagem', valor: 1 }, 400);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'outros', valor: 0 }, 400);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'outros', valor: 1, recibo: { nome: 'a.txt', conteudoBase64: Buffer.from('oi').toString('base64') } }, 400);
    const tx = (await db.query('SELECT t.expense_kind,c.name AS cat FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.id=$1', [g1.id])).rows[0];
    assert.deepEqual(tx, { expense_kind: 'deslocamento', cat: 'Transporte' });
    const att = (await db.query('SELECT category,mime_type FROM transaction_attachments WHERE transaction_id=$1', [g1.id])).rows[0];
    assert.deepEqual(att, { category: 'recibo', mime_type: 'image/jpeg' });
    // Despesa comum (tela de lancamentos) entra no resumo pelo nome da categoria; excluida nao conta.
    const catMat = (await db.query("SELECT id FROM categories WHERE name='Serviços terceirizados'")).rows[0].id;
    await request('/lancamentos', 'POST', { tipo: 'despesa', cost_center_id: id, category_id: catMat, descricao: 'Ajudante', valor: 100, data: '2026-10-03' }, 201);
    const del = await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'outros', valor: 999 }, 201);
    await db.query('UPDATE transactions SET deleted_at=NOW() WHERE id=$1', [del.id]);
    const r = await request(`/servicos/${id}/resumo`);
    assert.equal(r.cobrado, 1500);
    assert.equal(r.gastos, 350);
    assert.equal(r.resultado, 1150);
    assert.equal(r.margem, 76.7);
    const by = Object.fromEntries(r.gastosPorTipo.map((g) => [g.tipo, g.total]));
    assert.deepEqual(by, { deslocamento: 42.5, combustivel: 50, material: 157.5, mao_de_obra: 100, outros: 0 });
    const gastos = await request(`/servicos/${id}/gastos`);
    assert.equal(gastos.length, 4);
  });

  await context.test('tecnico nao recebe valor cobrado, resultado nem margem', async () => {
    const d = await request(`/servicos/${id}`, 'GET', undefined, 200, tec);
    assert.equal(d.veValores, false);
    assert.equal(d.valor, undefined);
    assert.equal(d.resumo.cobrado, undefined);
    assert.equal(d.resumo.resultado, undefined);
    assert.equal(d.resumo.margem, undefined);
    assert.equal(d.resumo.gastos, 350);
    const r = await request(`/servicos/${id}/resumo`, 'GET', undefined, 200, tec);
    assert.equal(r.margem, undefined);
    const l = (await request('/servicos', 'GET', undefined, 200, tec)).find((x) => x.id === id);
    assert.equal(l.valor, undefined);
    assert.equal(l.margem, undefined);
    const html = await request(`/servicos/${id}/relatorio`, 'GET', undefined, 200, tec);
    assert.doesNotMatch(html, /1\.500,00/);
    // Escopo por obra: tecnico sem a obra atribuida nao entra.
    await db.query("UPDATE users SET all_cost_centers=FALSE WHERE email='tec@teste.local'");
    await request(`/servicos/${id}`, 'GET', undefined, 403, tec);
    await request(`/servicos/${id}/gastos`, 'POST', { tipo: 'outros', valor: 1 }, 403, tec);
    assert.equal((await request('/servicos', 'GET', undefined, 200, tec)).length, 0);
    const uid = (await db.query("SELECT id FROM users WHERE email='tec@teste.local'")).rows[0].id;
    await db.query('INSERT INTO user_cost_centers (user_id,cost_center_id) VALUES ($1,$2)', [uid, id]);
    await request(`/servicos/${id}`, 'GET', undefined, 200, tec);
  });

  await context.test('concluir responde pendencias; checklist, fotos e aceite', async () => {
    const p = await request(`/servicos/${id}/pendencias`);
    assert.deepEqual(p.pendencias.map((x) => x.codigo), ['sem_foto_antes', 'sem_foto_depois', 'sem_aceite']);
    const c = await request(`/servicos/${id}/checklist`, 'PUT', { itens: [{ texto: 'Fixar cameras' }, { texto: 'Testar gravacao', feito: true }] }, 200, tec);
    assert.equal(c.itens.length, 2);
    const blocked = await request(`/servicos/${id}/concluir`, 'POST', {}, 409, tec);
    assert.equal(blocked.codigo, 'pendencias');
    assert.deepEqual(blocked.pendencias.map((x) => x.codigo), ['checklist_incompleto', 'sem_foto_antes', 'sem_foto_depois', 'sem_aceite']);
    await request(`/servicos/${id}/checklist/${c.itens[0].id}`, 'PATCH', { feito: true }, 200, tec);
    const antes = await request(`/servicos/${id}/fotos`, 'POST', { fase: 'antes', nome: 'antes.jpg', tipo: 'image/jpeg', conteudoBase64: jpg('antes') }, 201, tec);
    assert.equal(antes.fase, 'antes');
    await request(`/servicos/${id}/fotos`, 'POST', { fase: 'antes', nome: 'antes.jpg', conteudoBase64: jpg('antes') }, 409, tec);
    await request(`/servicos/${id}/fotos`, 'POST', { fase: 'meio', conteudoBase64: jpg('x') }, 400, tec);
    await request(`/servicos/${id}/fotos`, 'POST', { fase: 'depois', nome: 'depois.jpg', conteudoBase64: jpg('depois') }, 201, tec);
    const file = await fetch(`${base}/servicos/${id}/fotos/${antes.id}/arquivo`, { headers: { Authorization: `Bearer ${tec}` } });
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    await request(`/servicos/${id}/aceite`, 'PUT', { nome: 'Sindico Joao', assinatura: { conteudoBase64: jpg('nao png') } }, 400, tec);
    await request(`/servicos/${id}/aceite`, 'PUT', { assinatura: { conteudoBase64: PNG } }, 400, tec);
    const a = await request(`/servicos/${id}/aceite`, 'PUT', { nome: 'Sindico Joao', cargo: 'Sindico', dataHora: '2026-10-03T15:30:00-03:00', assinatura: { conteudoBase64: PNG } }, 200, tec);
    assert.equal(a.nome, 'Sindico Joao');
    assert.equal(new Date(a.dataHora).toISOString(), '2026-10-03T18:30:00.000Z');
    assert.equal((await request(`/servicos/${id}/pendencias`)).pendencias.length, 0);
    const ok = await request(`/servicos/${id}/concluir`, 'POST', {}, 200, tec);
    assert.equal(ok.situacao, 'concluido');
    await request(`/servicos/${id}/concluir`, 'POST', {}, 409, tec);
    assert.equal((await db.query('SELECT project_status FROM cost_centers WHERE id=$1', [id])).rows[0].project_status, 'concluido');
  });

  await context.test('concluir com pendencias exige flag explicita e guarda o que faltava', async () => {
    const s2 = await request('/servicos', 'POST', { cliente: 'Loja Y', valor: 300 }, 201);
    const done = await request(`/servicos/${s2.id}/concluir`, 'POST', { comPendencias: true });
    assert.equal(done.pendencias.length, 3);
    const d = await request(`/servicos/${s2.id}`);
    assert.equal(d.conclusao.pendenciasNaConclusao.length, 3);
    // Reabrir exige p5 (tecnico nao reabre).
    await request(`/servicos/${s2.id}/situacao`, 'PUT', { situacao: 'em_andamento' }, 403, tec);
    assert.equal((await request(`/servicos/${s2.id}/situacao`, 'PUT', { situacao: 'em_andamento' })).situacao, 'em_andamento');
  });

  await context.test('relatorio do cliente sem custos internos', async () => {
    const html = await request(`/servicos/${id}/relatorio`);
    assert.match(html, /Relatório do serviço/);
    assert.match(html, /Sindico Joao/);
    assert.match(html, /Fixar cameras/);
    assert.match(html, /1\.500,00/);
    assert.match(html, /data:image\/jpeg;base64/);
    assert.match(html, /data:image\/png;base64/);
    for (const forbidden of [/Uber/, /gasto/i, /margem/i, /resultado/i, /42,50/, /157,50/, /Ajudante/]) assert.doesNotMatch(html, forbidden);
  });

  await context.test('servico vira obra pelo editar e os lancamentos ficam', async () => {
    const cc = await request(`/centros-custo/${id}/detalhes`);
    await request(`/centros-custo/${id}`, 'PUT', { codigo: 'SV-1014', nome: cc.centro.nome, cliente: 'Condominio Sol', valor_contrato: 1500, tipo: 'obra', situacao: 'concluido' });
    await request(`/servicos/${id}`, 'GET', undefined, 404);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM transactions WHERE cost_center_id=$1 AND deleted_at IS NULL", [id])).rows[0].n, 4);
    await request(`/centros-custo/${id}`, 'PUT', { codigo: 'SV-1014', nome: cc.centro.nome, cliente: 'Condominio Sol', valor_contrato: 1500, tipo: 'servico', situacao: 'concluido' });
    const back = await request(`/servicos/${id}`);
    assert.equal(back.situacao, 'concluido');
    assert.equal(back.gastos.length, 4);
  });
});
