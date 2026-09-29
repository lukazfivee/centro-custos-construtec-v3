const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { documentoValido, formatarDocumento } = require('../lib/documento');
const schedule = require('../services/recurringSchedule');
const { currentMonth, todayIso } = require('../lib/dates');

// Desktop novo (D5): CPF/CNPJ, agenda por mes dos recorrentes, categorias e fornecedores.
test('CPF e CNPJ: dígito verificador e formatação', () => {
  assert.equal(documentoValido('111.444.777-35').tipo, 'CPF');
  assert.equal(documentoValido('11.222.333/0001-81').tipo, 'CNPJ');
  assert.equal(documentoValido('11.222.333/0001-82'), null);
  assert.equal(documentoValido('111.111.111-11'), null);
  assert.equal(documentoValido('123'), null);
  assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatarDocumento('11144477735'), '111.444.777-35');
});

test('agenda por mês: parcela, dia limitado ao mês e fim das parcelas', () => {
  const mensal = { frequency: 'mensal', day_of_month: 31, total_installments: 3, inicio: '2026-01' };
  assert.deepEqual(schedule.ocorrencia(mensal, '2026-02'), { parcela: 2, data: '2026-02-28' });
  assert.equal(schedule.ocorrencia(mensal, '2025-12'), null);
  assert.equal(schedule.ocorrencia(mensal, '2026-04'), null, 'a 4ª parcela passa do total');
  const bimestral = { frequency: 'bimestral', day_of_month: 5, total_installments: null, inicio: '2026-09' };
  assert.deepEqual(schedule.ocorrencia(bimestral, '2026-11'), { parcela: 2, data: '2026-11-05' });
  assert.equal(schedule.ocorrencia(bimestral, '2026-10'), null);
  assert.deepEqual(schedule.ocorrencia({ ...bimestral, inicio: '2026-11' }, '2027-01'), { parcela: 2, data: '2027-01-05' }, 'vira o ano');
});

test('mês de início padrão e próxima geração', () => {
  assert.equal(schedule.inicioPadrao(10, '2026-09-05'), '2026-09', 'o dia ainda não passou');
  assert.equal(schedule.inicioPadrao(5, '2026-09-20'), '2026-10', 'o dia já passou');
  assert.equal(schedule.inicioPadrao(5, '2026-12-20'), '2027-01');
  assert.equal(schedule.inicioPadrao(null, '2026-09-20'), '2026-09');
  const modelo = { frequency: 'mensal', day_of_month: 5, total_installments: 2, inicio: '2026-09' };
  assert.equal(schedule.proximaGeracao(modelo, '2026-09-20'), '2026-10-05');
  assert.equal(schedule.proximaGeracao(modelo, '2026-10-06'), null, 'as duas parcelas já passaram');
});

test('D5: telas registradas e carregadas pelo index do desktop', () => {
  const raiz = path.join(__dirname, '..', 'public', 'd');
  const index = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const arquivos = ['cadastros-base', 'categoria-form', 'categorias', 'fornecedor-form', 'fornecedores', 'recorrente-gerar', 'recorrente-form', 'recorrentes'];
  for (const nome of arquivos) assert.ok(index.includes(`telas/${nome}.js`), `${nome}.js fora do index`);
  assert.ok(index.includes('css/cadastros.css'));
  for (const tela of ['categorias', 'fornecedores', 'recorrentes']) {
    assert.ok(fs.readFileSync(path.join(raiz, 'telas', `${tela}.js`), 'utf8').includes(`D.tela('${tela}'`), `${tela} não se registra`);
  }
  // A regra de papel do servidor: so admin e gestor gravam; o menu mantem Recorrentes so para admin (regra atual).
  const recorrentes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'recurring.js'), 'utf8');
  assert.equal((recorrentes.match(/exigirPapel\('admin','gestor'\)/g) || []).length, 4, 'criar, editar, excluir e gerar exigem admin ou gestor');
});

test('cadastros: categorias, fornecedores e recorrentes por mês', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-d5-'));
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

  async function request(url, method, body, status, token) {
    const response = await fetch(`${base}${url}`, {
      method: method || 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const admin = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  await request('/usuarios', 'POST', { nome: 'Supervisor', email: 'sup@teste.local', senha: 'senha-sup-1234', role: 'supervisor' }, 201, admin);
  const sup = (await request('/auth/login', 'POST', { email: 'sup@teste.local', senha: 'senha-sup-1234' }, 200)).token;
  const mes = currentMonth();

  await context.test('categorias: cor, descrição, nome repetido e totais do mês', async () => {
    const criada = await request('/categorias', 'POST', { nome: 'Licenças de software', tipo: 'despesa', descricao: 'Softwares de gestão', cor: '#8A5CD0' }, 201, admin);
    assert.equal(criada.color, '#8a5cd0');
    await request('/categorias', 'POST', { nome: 'X', tipo: 'despesa', cor: '#ff0000' }, 400, admin);
    await request('/categorias', 'POST', { nome: 'Sem permissão', tipo: 'despesa' }, 403, sup);
    const repetida = await request('/categorias', 'POST', { nome: 'LICENCAS  de software', tipo: 'receita' }, 409, admin);
    assert.match(repetida.erro, /Licenças de software/);
    await request(`/categorias?mes=2026-13`, 'GET', undefined, 400, admin);

    const centro = await request('/centros-custo', 'POST', { codigo: 'D5-001', nome: 'Obra D5', orcamento: 0, situacao: 'execucao' }, 201, admin);
    await request('/lancamentos', 'POST', { tipo: 'despesa', cost_center_id: centro.id, category_id: criada.id, descricao: 'Licença', valor: 250.5, data: `${mes}-10`, status_financeiro: 'pendente', favorecido: 'Loja Alfa' }, 201, admin);
    const lista = await request(`/categorias?mes=${mes}`, 'GET', undefined, 200, admin);
    const linha = lista.find((c) => c.id === criada.id);
    assert.equal(Number(linha.lancamentos_mes), 1);
    assert.equal(Number(linha.total_mes), 250.5);
    assert.equal(linha.cor, '#8a5cd0');
    assert.equal(linha.descricao, 'Softwares de gestão');
    const outroMes = await request('/categorias?mes=2020-01', 'GET', undefined, 200, admin);
    assert.equal(Number(outroMes.find((c) => c.id === criada.id).lancamentos_mes), 0);
    await request(`/categorias/${criada.id}`, 'PUT', { nome: 'Licenças de software', tipo: 'despesa', cor: '#12a9d1', ativo: true }, 200, admin);
    const outra = await request('/categorias', 'POST', { nome: 'Outra categoria', tipo: 'despesa' }, 201, admin);
    const conflito = await request(`/categorias/${outra.id}`, 'PUT', { nome: 'licencas de SOFTWARE', tipo: 'despesa' }, 409, admin);
    assert.match(conflito.erro, /Licenças de software/);
    context.centro = centro.id;
    context.categoria = criada.id;
  });

  await context.test('fornecedores: CPF/CNPJ, duplicidade, gasto do mês e painel', async () => {
    await request('/fornecedores', 'POST', { nome: 'Doc curto', documento: '123' }, 400, admin);
    await request('/fornecedores', 'POST', { nome: 'CNPJ errado', documento: '11.222.333/0001-82' }, 400, admin);
    await request('/fornecedores', 'POST', { nome: 'Sem permissão', documento: '11.222.333/0001-81' }, 403, sup);
    const alfa = await request('/fornecedores', 'POST', { nome: 'Loja Alfa', documento: '11222333000181', contato: 'Ana', categoria_id: context.categoria }, 201, admin);
    const repetido = await request('/fornecedores', 'POST', { nome: 'Outra Loja', documento: '11.222.333/0001-81' }, 409, admin);
    assert.match(repetido.erro, /CNPJ: Loja Alfa/);
    await request('/fornecedores', 'POST', { nome: 'Pessoa', documento: '111.444.777-35' }, 201, admin);
    await request('/fornecedores', 'POST', { nome: 'Categoria falsa', categoria_id: 99999 }, 400, admin);

    const lista = await request(`/fornecedores?mes=${mes}`, 'GET', undefined, 200, admin);
    const linha = lista.find((f) => f.id === alfa.id);
    assert.equal(linha.documento, '11.222.333/0001-81', 'guardado formatado');
    assert.equal(Number(linha.gasto_mes), 250.5);
    assert.equal(Number(linha.lancamentos_mes), 1);
    assert.equal(linha.categoria, 'Licenças de software');
    const busca = await request(`/fornecedores?busca=${encodeURIComponent('Ana')}`, 'GET', undefined, 200, admin);
    assert.equal(busca.length, 1, 'a busca também acha pelo contato');

    const resumo = await request(`/fornecedores/${alfa.id}/resumo?mes=${mes}`, 'GET', undefined, 200, sup);
    assert.equal(resumo.lancamentos.length, 1);
    assert.equal(resumo.gasto_mes, 250.5);
    await request('/fornecedores/99999/resumo', 'GET', undefined, 404, admin);

    // Documento antigo, mal digitado, nao trava a edicao de outros campos.
    await getDb().query("UPDATE suppliers SET document='99.999.999/9999-99' WHERE id=$1", [alfa.id]);
    await request(`/fornecedores/${alfa.id}`, 'PUT', { nome: 'Loja Alfa', documento: '99.999.999/9999-99', telefone: '1133334444' }, 200, admin);
    await request(`/fornecedores/${alfa.id}`, 'PUT', { nome: 'Loja Alfa', documento: '99.999.999/9999-98' }, 400, admin);
  });

  await context.test('recorrentes: prévia, gerar por mês sem duplicar e próxima geração', async () => {
    const dia = 15;
    const modelo = { nome: 'Locação de plataforma', tipo: 'despesa', cost_center_id: context.centro, category_id: context.categoria, favorecido: 'Loja Alfa', valor: 3800, dia_mes: dia, frequencia: 'mensal', total_parcelas: 6, inicio: mes };
    const criado = await request('/recorrentes', 'POST', modelo, 201, admin);
    await request('/recorrentes', 'POST', { ...modelo, nome: 'Mês que vem', valor: 100, inicio: schedule.somarMeses(mes, 1) }, 201, admin);
    await request('/recorrentes', 'POST', { ...modelo, inicio: '2026-99' }, 400, admin);
    await request('/recorrentes', 'POST', modelo, 403, sup);

    const previa = await request(`/recorrentes/previa?mes=${mes}`, 'GET', undefined, 200, sup);
    assert.equal(previa.total_itens, 1);
    assert.equal(previa.total_valor, 3800);
    assert.equal(previa.itens[0].data, `${mes}-15`);
    assert.equal(previa.itens[0].parcela, 1);
    const proximo = await request(`/recorrentes/previa?mes=${schedule.somarMeses(mes, 1)}`, 'GET', undefined, 200, admin);
    assert.equal(proximo.total_itens, 2, 'o do mês que vem entra, e a parcela 2 do primeiro também');
    await request('/recorrentes/previa?mes=2019-01', 'GET', undefined, 400, admin);

    await request('/recorrentes/gerar', 'POST', { mes: schedule.somarMeses(mes, 1) }, 400, admin);
    await request('/recorrentes/gerar', 'POST', {}, 403, sup);
    const gerado = await request('/recorrentes/gerar', 'POST', {}, 200, admin);
    assert.equal(gerado.gerados, 1);
    const transacao = (await getDb().query("SELECT financial_status,transaction_date::text AS data,description,amount::float AS valor FROM transactions WHERE description LIKE 'Locação de plataforma%'")).rows;
    assert.deepEqual(transacao, [{ financial_status: 'pendente', data: `${mes}-15`, description: 'Locação de plataforma (1/6)', valor: 3800 }]);

    const outra = await request('/recorrentes/gerar', 'POST', {}, 200, admin);
    assert.equal(outra.gerados, 0, 'gerar de novo no mesmo mês não duplica');
    const depois = await request(`/recorrentes/previa?mes=${mes}`, 'GET', undefined, 200, admin);
    assert.equal(depois.total_itens, 0);
    assert.equal(depois.gerados.length, 1, 'o mês aparece como já gerado');

    const lista = await request('/recorrentes', 'GET', undefined, 200, admin);
    const linha = lista.find((m) => m.id === criado.id);
    assert.equal(linha.geradas, 1);
    assert.equal(linha.inicio, mes);
    assert.ok(linha.proxima_geracao >= todayIso());

    const p = await request(`/recorrentes/proxima?frequencia=mensal&dia_mes=${dia}&inicio=${mes}`, 'GET', undefined, 200, sup);
    assert.equal(p.inicio, mes);
    await request('/recorrentes/proxima?frequencia=quinzenal', 'GET', undefined, 400, admin);
  });

  await context.test('recorrentes: mês pulado não trava e modelo pausado não gera', async () => {
    const passado = schedule.somarMeses(mes, -2);
    const criado = await request('/recorrentes', 'POST', { nome: 'Antigo', tipo: 'despesa', cost_center_id: context.centro, category_id: context.categoria, valor: 500, dia_mes: 3, frequencia: 'mensal', inicio: passado }, 201, admin);
    const previaAtual = await request(`/recorrentes/previa?mes=${mes}`, 'GET', undefined, 200, admin);
    assert.ok(previaAtual.itens.some((i) => i.id === criado.id && i.parcela === 3), 'a parcela é do mês, não do contador');
    const atrasado = await request('/recorrentes/gerar', 'POST', { mes: passado }, 200, admin);
    assert.equal(atrasado.gerados, 1, 'dá para gerar um mês passado escolhendo o mês');
    await request(`/recorrentes/${criado.id}`, 'PUT', { nome: 'Antigo', tipo: 'despesa', cost_center_id: context.centro, category_id: context.categoria, valor: 500, dia_mes: 3, frequencia: 'mensal', ativo: false }, 200, admin);
    const pausado = await request(`/recorrentes/previa?mes=${mes}`, 'GET', undefined, 200, admin);
    assert.ok(!pausado.itens.some((i) => i.id === criado.id));
  });
});
