const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { iniciar } = require('../scripts/dev/fake-commercial-worker');

// Desktop novo (D7): resumo por mes, checklist "Antes de fechar", fechar com pendencias gravadas
// e reabrir com motivo de pelo menos 10 caracteres. Fechar e reabrir sao so do administrador (p8).
test('fechamento mensal: resumo, checklist, pendências gravadas e reabertura com motivo', async (context) => {
  const obras = [
    { publicId: '11111111-1111-4111-8111-111111111111', code: 'CC-031', name: 'Residencial Aurora', client: 'Aurora', responsible: 'Carla', contractAmount: 1000, projectStatus: 'concluido' },
    { publicId: '22222222-2222-4222-8222-222222222222', code: 'CC-032', name: 'Galpão Beta', client: 'Beta', responsible: 'Caio', contractAmount: 500, projectStatus: 'execucao' },
  ];
  const worker = await iniciar({ obras });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-fechamento-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  process.env.SYNC_API_URL = worker.url;
  process.env.SYNC_SHARED_KEY = 'chave-de-teste';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await worker.fechar();
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.SYNC_API_URL;
    delete process.env.SYNC_SHARED_KEY;
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
  await request('/usuarios', 'POST', { nome: 'Gestor', email: 'gestor@teste.local', senha: 'senha-gestor-123', role: 'gestor' }, 201, admin);
  const gestor = (await request('/auth/login', 'POST', { email: 'gestor@teste.local', senha: 'senha-gestor-123' }, 200)).token;
  // Administrador com e-mail da empresa: so ele enxerga as cobrancas do servico corporativo.
  await request('/usuarios', 'POST', { nome: 'Chefe', email: 'chefe@rcconstrutec.com.br', senha: 'senha-chefe-1234', role: 'admin' }, 201, admin);
  const jwt = require('jsonwebtoken');
  const { rows: chefeRows } = await getDb().query('SELECT id FROM users WHERE email=$1', ['chefe@rcconstrutec.com.br']);
  const chefe = jwt.sign({}, process.env.JWT_SECRET, { subject: String(chefeRows[0].id), expiresIn: '1h' });

  const obra = (await request('/centros-custo', 'POST', { codigo: 'OB-7', nome: 'Obra Fechamento', orcamento: 1000 }, 201, admin)).id;
  const categorias = await request('/categorias', 'GET', undefined, 200, admin);
  const despesa = categorias.find((c) => c.tipo === 'despesa').id;
  const receita = categorias.find((c) => c.tipo !== 'despesa').id;
  const lancar = (tipo, valor, status, extra = {}) => request('/lancamentos', 'POST', {
    tipo, valor, status_financeiro: status, data: '2026-09-10', vencimento: '2026-09-10',
    data_liquidacao: status === 'liquidado' ? '2026-09-10' : undefined,
    cost_center_id: obra, category_id: tipo === 'receita' ? receita : despesa, descricao: `${tipo} ${valor}`, ...extra,
  }, 201, admin);
  await lancar('receita', 900, 'liquidado');
  await lancar('despesa', 200, 'liquidado');
  await lancar('despesa', 50, 'pendente');

  // Resumo do ano: 12 meses, com os totais de setembro.
  const resumo = await request('/fechamento-mensal/resumo?ano=2026', 'GET', undefined, 200, admin);
  assert.equal(resumo.meses.length, 12);
  const setembro = resumo.meses[8];
  assert.deepEqual([setembro.receitas, setembro.despesas, setembro.resultado, setembro.lancamentos, setembro.em_aberto, setembro.fechado],
    [900, 200, 700, 3, 1, false]);
  assert.equal(resumo.meses[0].lancamentos, 0);
  assert.equal((await request('/fechamento-mensal/resumo?ano=1999', 'GET', undefined, 400, admin)).erro, 'Ano inválido.');
  await request('/fechamento-mensal/resumo?ano=2026', 'GET', undefined, 403, gestor);

  // Checklist: conta vencida pela data de Brasilia, despesa paga sem anexo, lancamento em aberto.
  const lista = await request('/fechamento-mensal/checklist?ano=2026&mes=9', 'GET', undefined, 200, admin);
  const item = (chave) => lista.itens.find((i) => i.chave === chave);
  assert.equal(item('vencidas').quantidade, 1);
  assert.equal(item('vencidas').valor, 50);
  assert.equal(item('vencidas').situacao, 'pendente');
  assert.equal(item('sem_documento').quantidade, 1);
  assert.equal(item('em_aberto').situacao, 'info');
  assert.equal(item('recorrentes').situacao, 'ok');
  assert.equal(item('cobrancas').situacao, 'indisponivel', 'sem e-mail da empresa, a nuvem não responde');
  assert.equal(lista.total_pendencias, 2);
  assert.equal(lista.fechado, false);
  await request('/fechamento-mensal/checklist?ano=2026&mes=13', 'GET', undefined, 400, admin);
  await request('/fechamento-mensal/checklist?ano=2026', 'GET', undefined, 400, admin);
  await request('/fechamento-mensal/checklist?ano=2026&mes=9', 'GET', undefined, 403, gestor);
  const comNuvem = await request('/fechamento-mensal/checklist?ano=2026&mes=9', 'GET', undefined, 200, chefe);
  assert.equal(comNuvem.itens.find((i) => i.chave === 'cobrancas').quantidade, 1, 'só a obra com medição aprovada vira cobrança pendente');
  assert.equal(comNuvem.total_pendencias, 3);

  // O "Ver" da despesa sem documento: filtro novo da lista.
  const semAnexo = await request('/lancamentos?mes=2026-09&tipo=despesa&situacao=liquidado&semAnexo=1&pagina=1&limite=50', 'GET', undefined, 200, admin);
  assert.equal(semAnexo.paginacao.total, 1);

  // Fechar: validacoes, 403, pendencias gravadas e 409.
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9 }, 403, gestor);
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 13 }, 400, admin);
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9, pendencias: 'tudo' }, 400, admin);
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9, pendencias: [{ chave: 'vencidas', quantidade: 1 }] }, 400, admin);
  const pendencias = [
    { chave: 'vencidas', titulo: '1 conta a pagar vencida', quantidade: 1, valor: 50, detalhe: 'R$ 50,00 em atraso.' },
    { chave: 'sem_documento', titulo: '1 despesa paga sem documento', quantidade: 1 },
  ];
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9, pendencias }, 201, admin);
  assert.equal((await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9 }, 409, admin)).erro, 'Este mês já está fechado.');
  const fechamentos = await request('/fechamento-mensal', 'GET', undefined, 200, admin);
  assert.equal(fechamentos.length, 1);
  assert.equal(fechamentos[0].pendencias.length, 2);
  const fechadoResumo = (await request('/fechamento-mensal/resumo?ano=2026', 'GET', undefined, 200, admin)).meses[8];
  assert.equal(fechadoResumo.fechado, true);
  assert.equal(fechadoResumo.fechado_por, 'Administrador');
  assert.equal(fechadoResumo.pendencias[0].titulo, '1 conta a pagar vencida');
  const { rows: auditoria } = await getDb().query("SELECT summary,data FROM audit_log WHERE entity_type='fechamento' AND action='fechado'");
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].data.pendencias.length, 2);
  assert.match(auditoria[0].summary, /2 pendências registradas/);
  // Mes fechado: o lancamento nao muda mais.
  await request('/lancamentos', 'POST', { tipo: 'despesa', valor: 10, status_financeiro: 'pendente', data: '2026-09-20', vencimento: '2026-09-20', cost_center_id: obra, category_id: despesa, descricao: 'tarde demais' }, 403, admin);

  // Reabrir: motivo obrigatorio de 10 caracteres, so admin, 404 e auditoria.
  const id = fechamentos[0].id;
  await request(`/fechamento-mensal/${id}`, 'DELETE', { motivo: 'NF da Seg Distribuidora chegou' }, 403, gestor);
  const semMotivo = await request(`/fechamento-mensal/${id}`, 'DELETE', undefined, 400, admin);
  assert.match(semMotivo.erro, /pelo menos 10 caracteres/);
  await request(`/fechamento-mensal/${id}`, 'DELETE', { motivo: 'curto' }, 400, admin);
  await request(`/fechamento-mensal/${id}`, 'DELETE', { motivo: '   123456789   ' }, 400, admin);
  await request('/fechamento-mensal/999999', 'DELETE', { motivo: 'NF da Seg Distribuidora chegou' }, 404, admin);
  assert.equal((await request('/fechamento-mensal', 'GET', undefined, 200, admin)).length, 1, 'recusas não reabrem o mês');
  await request(`/fechamento-mensal/${id}`, 'DELETE', { motivo: 'NF da Seg Distribuidora chegou' }, 200, admin);
  assert.equal((await request('/fechamento-mensal', 'GET', undefined, 200, admin)).length, 0);
  const reaberto = (await request('/fechamento-mensal/resumo?ano=2026', 'GET', undefined, 200, admin)).meses[8];
  assert.equal(reaberto.fechado, false);
  assert.equal(reaberto.reaberto.motivo, 'NF da Seg Distribuidora chegou');
  assert.equal(reaberto.reaberto.por, 'Administrador');
  const { rows: reabertura } = await getDb().query("SELECT data FROM audit_log WHERE entity_type='fechamento' AND action='reaberto'");
  assert.equal(reabertura.length, 1);
  assert.equal(reabertura[0].data.motivo, 'NF da Seg Distribuidora chegou');
  assert.equal(reabertura[0].data.pendencias.length, 2, 'a reabertura guarda as pendências que o mês tinha');
  // Fechado de novo sem pendencias: o motivo da reabertura continua visivel.
  await request('/fechamento-mensal', 'POST', { ano: 2026, mes: 9 }, 201, admin);
  const refechado = (await request('/fechamento-mensal/resumo?ano=2026', 'GET', undefined, 200, admin)).meses[8];
  assert.equal(refechado.fechado, true);
  assert.deepEqual(refechado.pendencias, []);
  assert.equal(refechado.reaberto.motivo, 'NF da Seg Distribuidora chegou');
});
