const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Desktop novo (D1): o painel mostra quantos recebimentos e despesas liquidadas houve no mes
// e abre o lancamento das atividades recentes com favorecido, documento e obra.
test('resumo do painel traz as contagens do mês e os campos das atividades recentes', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-inicio-'));
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
    const data = await response.json();
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  token = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  const obra = (await request('/centros-custo', 'POST', { codigo: 'OB-9', nome: 'Obra Painel', orcamento: 1000 }, 201)).id;
  const categorias = await request('/categorias');
  const despesa = categorias.find((c) => c.tipo === 'despesa').id;
  const receita = categorias.find((c) => c.tipo !== 'despesa').id;
  const lancar = (tipo, valor, status, extra = {}) => request('/lancamentos', 'POST', {
    tipo, valor, status_financeiro: status, data: '2026-09-10', vencimento: '2026-09-10',
    data_liquidacao: status === 'liquidado' ? '2026-09-10' : undefined,
    cost_center_id: obra, category_id: tipo === 'receita' ? receita : despesa, descricao: `${tipo} ${valor}`, ...extra,
  }, 201);

  await lancar('receita', 900, 'liquidado');
  const paga = await lancar('despesa', 200, 'liquidado', { favorecido: 'Seg Distribuidora', documento: 'NF-18442' });
  await lancar('despesa', 100, 'liquidado');
  await lancar('despesa', 50, 'pendente');
  // O estorno entra como lancamento de sinal contrario e nao conta como mais uma despesa paga.
  await request(`/lancamentos/${paga.id}/estornar`, 'POST', { motivo: 'Lançado em duplicidade', data_estorno: '2026-09-11' }, 201);

  const painel = await request('/dashboard/resumo?mes=2026-09', 'GET', undefined, 200);
  assert.equal(painel.qtdRecebidos, 1);
  assert.equal(painel.qtdPagos, 2);
  assert.equal(painel.despesas, 100);
  const daObra = await request(`/dashboard/resumo?mes=2026-09&centroId=${obra}`, 'GET', undefined, 200);
  assert.equal(daObra.qtdPagos, 2);

  const recente = painel.ultimosLancamentos.find((l) => l.id === paga.id);
  assert.equal(recente.favorecido, 'Seg Distribuidora');
  assert.equal(recente.documento, 'NF-18442');
  assert.equal(recente.centro_codigo, 'OB-9');
  assert.equal(recente.data_liquidacao, '2026-09-10');

  // Evolucao: 6 meses por padrao (painel atual) e 12 quando o desktop novo pede.
  assert.equal(painel.tendencia.length, 6);
  const doze = await request('/dashboard/resumo?mes=2026-09&meses=12', 'GET', undefined, 200);
  assert.equal(doze.tendencia.length, 12);
  assert.equal(doze.tendencia[0].mes, '2025-10');
  assert.equal(doze.tendencia.at(-1).mes, '2026-09');
  await request('/dashboard/resumo?mes=2026-09&meses=30', 'GET', undefined, 400);

  const vazio = await request('/dashboard/resumo?mes=2026-10', 'GET', undefined, 200);
  assert.equal(vazio.qtdRecebidos, 0);
  assert.equal(vazio.qtdPagos, 0);
});
