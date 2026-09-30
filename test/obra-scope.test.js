const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// D6: tecnico e engenharia com obras atribuidas so veem essas obras; as outras dao 403 por URL.
test('escopo por obra: lista, painel, lancamentos e anexos; 403 por URL fora do escopo', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-escopo-'));
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

  async function call(method, url, token, body, expected) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (expected) assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
    return { status: response.status, data };
  }
  const login = async (email, senha) => (await (await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }),
  })).json()).token;

  const admin = await login('admin@teste.local', 'senha-teste-123');
  const categoria = (await call('GET', '/categorias', admin, undefined, 200)).data.find((c) => c.tipo === 'despesa').id;
  const obras = [];
  for (const codigo of ['ESC-A', 'ESC-B', 'ESC-C']) {
    obras.push((await call('POST', '/centros-custo', admin, { codigo, nome: `Obra ${codigo}`, orcamento: 1000, situacao: 'execucao' }, 201)).data.id);
  }
  const lancs = [];
  for (const [i, obra] of obras.entries()) {
    lancs.push((await call('POST', '/lancamentos', admin, {
      tipo: 'despesa', cost_center_id: obra, category_id: categoria, descricao: `Gasto ${i}`, valor: 100 * (i + 1),
      data: '2026-09-15', status_financeiro: 'liquidado',
    }, 201)).data.id);
  }
  const [a, b, c] = obras;
  const [la, lb, lc] = lancs;

  async function conta(role, email, obrasIds, todas = false) {
    await call('POST', '/usuarios', admin, { nome: role, email, senha: `senha-${role}-123`, role: 'supervisor' }, 201);
    const { rows } = await getDb().query('SELECT id FROM users WHERE email=$1', [email]);
    await getDb().query('UPDATE users SET suite_role=$1, all_cost_centers=$2 WHERE id=$3', [role, todas, rows[0].id]);
    for (const obra of obrasIds) await getDb().query('INSERT INTO user_cost_centers(user_id,cost_center_id) VALUES($1,$2)', [rows[0].id, obra]);
    return login(email, `senha-${role}-123`);
  }


  for (const role of ['tecnico', 'engenharia']) {
    const token = await conta(role, `${role}@teste.local`, [a, b]);

    // Lista de obras e detalhe
    const lista = (await call('GET', '/centros-custo', token, undefined, 200)).data;
    assert.deepEqual(lista.map((o) => o.id).sort(), [a, b].sort(), `${role}: lista de obras`);
    const pag = (await call('GET', '/centros-custo?pagina=1&limite=10', token, undefined, 200)).data;
    assert.equal(pag.paginacao.total, 2);
    await call('GET', `/centros-custo/${a}/detalhes`, token, undefined, 200);
    await call('GET', `/centros-custo/${c}/detalhes`, token, undefined, 403);
    await call('GET', `/centros-custo/${c}/curva-s`, token, undefined, 403);
    await call('GET', `/centros-custo/${c}/orcado-realizado`, token, undefined, 403);
    await call('GET', `/centros-custo/${c}/medicoes`, token, undefined, 403);
    await call('GET', '/centros-custo/portfolio-summary', token, undefined, 403);

    // Painel: soma so as duas obras (100 + 200), ou 403 se pedir a outra.
    const painel = (await call('GET', '/dashboard/resumo?mes=2026-09', token, undefined, 200)).data;
    assert.equal(painel.despesas, 300, `${role}: painel soma so as obras atribuidas`);
    assert.deepEqual(painel.porCentro.map((o) => o.id).sort(), [a, b].sort());
    await call('GET', `/dashboard/resumo?mes=2026-09&centroId=${c}`, token, undefined, 403);
    assert.equal((await call('GET', `/dashboard/resumo?mes=2026-09&centroId=${a}`, token, undefined, 200)).data.despesas, 100);

    // Lancamentos
    const lancamentos = (await call('GET', '/lancamentos', token, undefined, 200)).data;
    assert.ok(lancamentos.some((l) => l.id === la) && lancamentos.some((l) => l.id === lb) && !lancamentos.some((l) => l.id === lc), `${role}: so lancamentos das obras atribuidas`);
    await call('GET', `/lancamentos?centroId=${c}`, token, undefined, 403);
    await call('GET', `/lancamentos/${la}`, token, undefined, 200);
    await call('GET', `/lancamentos/${lc}`, token, undefined, 403);
    const csv = await fetch(`${base}/lancamentos/exportar.csv`, { headers: { Authorization: `Bearer ${token}` } });
    const texto = await csv.text();
    assert.ok(texto.includes('Gasto 0') && !texto.includes('Gasto 2'), `${role}: CSV so com as obras atribuidas`);
    await call('POST', '/lancamentos', token, { tipo: 'despesa', cost_center_id: c, category_id: categoria, descricao: 'Fora', valor: 10, data: '2026-09-16', status_financeiro: 'pendente' }, 403);
    const meu = await call('POST', '/lancamentos', token, { tipo: 'despesa', cost_center_id: b, category_id: categoria, descricao: 'Dentro', valor: 10, data: '2026-09-16', status_financeiro: 'pendente' }, 201);
    assert.ok(meu.data.id);


    // Anexos de lancamento de outra obra
    await call('GET', `/anexos/lancamento/${lc}`, token, undefined, 403);
    await call('GET', `/anexos/lancamento/${la}`, token, undefined, 200);

    // Telas que somam tudo: fechadas para quem tem escopo.
    for (const url of ['/insights/atencao', '/historico', '/bancos/contas', '/recorrentes', '/sincronizacao/exportar.csv']) {
      await call('GET', url, token, undefined, 403);
    }
  }

  // Sem nenhuma obra atribuida: nao ve nada.
  const vazio = await conta('tecnico', 'vazio@teste.local', []);
  assert.deepEqual((await call('GET', '/centros-custo', vazio, undefined, 200)).data, []);
  assert.equal((await call('GET', '/dashboard/resumo?mes=2026-09', vazio, undefined, 200)).data.despesas, 0);
  assert.deepEqual((await call('GET', '/lancamentos', vazio, undefined, 200)).data, []);

  // all_cost_centers TRUE (conta antiga): ve tudo, como antes.
  const antigo = await conta('tecnico', 'antigo@teste.local', [], true);
  assert.equal((await call('GET', '/centros-custo', antigo, undefined, 200)).data.length, 3);
  await call('GET', `/lancamentos/${lc}`, antigo, undefined, 200);

  // Papeis sem escopo (financeiro) continuam vendo tudo.
  const fin = await conta('financeiro', 'fin@teste.local', []);
  assert.equal((await call('GET', '/centros-custo', fin, undefined, 200)).data.length, 3);
  assert.equal((await call('GET', '/dashboard/resumo?mes=2026-09', fin, undefined, 200)).data.despesas, 600);

  // p1 (painel financeiro): comercial nao tem; tecnico e engenharia abrem o painel limitado as suas obras.
  const com = await conta('comercial', 'com@teste.local', []);
  await call('GET', '/dashboard/resumo?mes=2026-09', com, undefined, 403);
});
