const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Desktop novo (D3a): rotas de orcamento separadas continuam no mesmo endereco, a edicao da obra
// confere a revisao quando ela vem, e um gasto so e vinculado/desvinculado pela propria obra.
test('obras: revisão na edição, rotas de orçamento e gasto preso à obra', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-obras-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase } = require('../db');
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

  let token = '';
  async function request(url, method = 'GET', body, status) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  token = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  const obra = { codigo: 'OB-1', nome: 'Obra A', orcamento: 1000, valor_contrato: 5000, situacao: 'execucao' };
  const a = (await request('/centros-custo', 'POST', obra, 201)).id;
  const b = (await request('/centros-custo', 'POST', { ...obra, codigo: 'OB-2', nome: 'Obra B' }, 201)).id;

  // Revisao: com a revisao certa salva; com a antiga, 409; sem revisao (sistema atual), salva como hoje.
  const lista = await request('/centros-custo');
  const rev = Number(lista.find((o) => o.id === a).revision);
  const salvo = await request(`/centros-custo/${a}`, 'PUT', { ...obra, nome: 'Obra A1', revisao: rev }, 200);
  assert.equal(salvo.revisao, rev + 1);
  const conflito = await request(`/centros-custo/${a}`, 'PUT', { ...obra, nome: 'Obra A2', revisao: rev }, 409);
  assert.match(conflito.erro, /alterada por outra pessoa/);
  await request(`/centros-custo/${a}`, 'PUT', { ...obra, nome: 'Obra A3' }, 200);
  await request(`/centros-custo/${a}`, 'PUT', { ...obra, revisao: 'x' }, 400);
  await request('/centros-custo/9999', 'PUT', { ...obra, revisao: 1 }, 404);
  assert.equal((await request('/centros-custo')).find((o) => o.id === a).orcamento, '1000.00');

  // As rotas de orcamento, agora em routes/costCenterBudget.js, respondem no mesmo endereco.
  assert.equal((await request(`/centros-custo/${a}/orcado-realizado`, 'GET', undefined, 200)).hasBudget, false);
  assert.ok(Array.isArray(await request(`/centros-custo/${a}/baselines`, 'GET', undefined, 200)));
  assert.deepEqual(await request(`/centros-custo/${a}/medicoes`, 'GET', undefined, 200), { labor: [], contracts: [] });

  // Gasto da obra A: nao pode ser desvinculado nem vinculado pela obra B.
  const categorias = await request('/categorias');
  const cat = categorias.find((c) => c.tipo === 'despesa').id;
  const gasto = await request('/lancamentos', 'POST', { tipo: 'despesa', valor: 100, data: '2026-09-10', status_financeiro: 'liquidado', cost_center_id: a, category_id: cat, descricao: 'Cabo' }, 201);
  const aloc = await request(`/centros-custo/${a}/apropriacoes`, 'POST', { transactionId: gasto.id, amount: 100 }, 201);
  assert.ok(aloc.id);
  await request(`/centros-custo/${b}/apropriacoes/${aloc.id}/desmapear`, 'POST', {}, 404);
  await request(`/centros-custo/${b}/apropriacoes`, 'POST', { allocationId: aloc.id, controlItemId: null }, 404);
  await request(`/centros-custo/${a}/apropriacoes/nao-e-uuid/desmapear`, 'POST', {}, 400);
  await request(`/centros-custo/${a}/apropriacoes/${aloc.id}/desmapear`, 'POST', {}, 200);

  // NF com PDF: lista e baixa pelo endereco novo; sem PDF, 404.
  const pdf = Buffer.from('%PDF-1.4 nota').toString('base64');
  const nf = await request(`/centros-custo/${a}/notas-fiscais`, 'POST', { tipo: 'fornecedor', status: 'paga', dataEmissao: '2026-09-10', valor: 100, nome: 'nf.pdf', conteudoBase64: pdf }, 201);
  const baixada = await fetch(`${base}/centros-custo/notas-fiscais/${nf.id}/arquivo`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(baixada.status, 200);
  assert.equal(baixada.headers.get('content-type'), 'application/pdf');
  assert.match(Buffer.from(await baixada.arrayBuffer()).toString('ascii'), /^%PDF-1\.4 nota/);
  const semPdf = await request(`/centros-custo/${a}/notas-fiscais`, 'POST', { tipo: 'cliente', status: 'nao_paga', dataEmissao: '2026-09-10', valor: 50 }, 201);
  await request(`/centros-custo/notas-fiscais/${semPdf.id}/arquivo`, 'GET', undefined, 404);

  // Resumo da carteira traz os numeros por obra (cartoes do desktop novo), sem mudar o resumo geral.
  const carteira = await request('/centros-custo/portfolio-summary', 'GET', undefined, 200);
  assert.ok(carteira.portfolio && typeof carteira.portfolio.totalCenters === 'number');
  const daA = carteira.porObra.find((o) => o.id === a);
  assert.equal(daA.realizedCost, 100);
  assert.equal(daA.baseCost, 0);
  assert.equal(daA.burnRate, null);
  assert.equal(daA.billed, 0);
});
