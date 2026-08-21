const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCsv, csvLine } = require('../lib/csv');

test('API local cobre obras, fluxo financeiro, fornecedores, sincronização, auditoria e perfis', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-test-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  process.env.INSTANCE_NAME = 'Instalação de teste';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  let server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin@teste.local', senha: 'senha-teste-123' } });
  const auth = login.token;
  const center = await request('/centros-custo', {
    method: 'POST', token: auth,
    body: { codigo: 'OBRA-001', nome: 'Hospital Teste', cliente: 'Cliente Teste', contrato: 'CT-2026-01',
      responsavel: 'Engenheiro Teste', orcamento: 5000, valor_contrato: 50000,
      data_inicio: '2026-08-01', data_fim: '2026-12-20', situacao: 'execucao' },
  });
  const centers = await request('/centros-custo', { token: auth });
  assert.equal(centers[0].cliente, 'Cliente Teste');
  assert.equal(centers[0].situacao, 'execucao');

  const supplier = await request('/fornecedores', {
    method:'POST',token:auth,body:{nome:'Fornecedor Teste',documento:'00.000.000/0001-00',contato:'Contato',email:'fornecedor@teste.local'},
  });
  assert.ok(supplier.id);
  const categories = await request('/categorias', { token: auth });
  const material = categories.find((item) => item.nome === 'Material');
  const transactionBody = { tipo: 'despesa', data: '2026-08-18', vencimento:'2026-08-10', status_financeiro:'pendente',
    cost_center_id: center.id,category_id: material.id, descricao: 'Material de obra',
    favorecido: 'Fornecedor Teste', documento:'NF-123', valor: 125.5 };
  const transaction = await request('/lancamentos', {
    method: 'POST', token: auth, body: transactionBody,
  });
  assert.match(transaction.public_id, /^[0-9a-f-]{36}$/i);

  const dashboard=await request('/dashboard/resumo?mes=2026-08',{token:auth});
  assert.equal(dashboard.aPagar,125.5);
  assert.equal(dashboard.vencidos,125.5);
  assert.equal(Number(dashboard.porCentro[0].comprometido),125.5);

  const report=await raw('/lancamentos/exportar.csv?situacao=pendente',auth);
  assert.match(report,/Situação/);
  assert.match(report,/Fornecedor Teste/);

  const beforeUpdate=(await request('/lancamentos',{token:auth}))[0];
  const firstUpdate=await request(`/lancamentos/${transaction.id}`,{
    method:'PUT',token:auth,body:{...transactionBody,descricao:'Material atualizado',revisao:beforeUpdate.revision},
  });
  assert.equal(firstUpdate.revisao,beforeUpdate.revision+1);
  await expectError(`/lancamentos/${transaction.id}`,{
    method:'PUT',token:auth,body:{...transactionBody,descricao:'Edição desatualizada',revisao:beforeUpdate.revision},
  },409);
  const updatedTransaction=(await request('/lancamentos',{token:auth}))[0];
  assert.equal(updatedTransaction.descricao,'Material atualizado');
  assert.equal(updatedTransaction.revision,beforeUpdate.revision+1);

  const smartExport = await raw('/sincronizacao-inteligente/exportar', auth);
  const smartPackage = JSON.parse(smartExport);
  assert.equal(smartPackage.formatVersion, 3);
  assert.match(smartPackage.payloadHash, /^[0-9a-f]{64}$/);
  assert.ok(smartPackage.payload.costCenters.some((item)=>item.code==='OBRA-001'));
  assert.ok(smartPackage.payload.suppliers.some((item)=>item.name==='Fornecedor Teste'));
  assert.ok(smartPackage.payload.transactions.some((item)=>item.publicId===transaction.public_id));
  const smartImport = await request('/sincronizacao-inteligente/importar', {
    method:'POST',token:auth,body:{nomeArquivo:'pacote-teste.ccsync',conteudo:smartExport},
  });
  assert.equal(smartImport.duplicado,false);
  assert.equal(smartImport.resumo.conflitos,0);
  assert.equal(smartImport.resumo.incluidos,0);
  assert.ok(smartImport.resumo.ignorados > 0);
  const smartDuplicate = await request('/sincronizacao-inteligente/importar', {
    method:'POST',token:auth,body:{nomeArquivo:'pacote-teste.ccsync',conteudo:smartExport},
  });
  assert.equal(smartDuplicate.duplicado,true);
  const smartHistory = await request('/sincronizacao-inteligente/historico',{token:auth});
  assert.ok(smartHistory.some((item)=>item.package_id===smartPackage.packageId));

  const exported = await raw('/sincronizacao/exportar.csv?sincronizar=1', auth);
  const exportedRows=parseCsv(exported);
  assert.ok(exportedRows[0].includes('status_financeiro'));
  const duplicate = await request('/sincronizacao/importar', {
    method: 'POST', token: auth, body: { nomeArquivo: 'duplicata.csv', conteudo: exported },
  });
  assert.equal(duplicate.ignorados, 1);
  assert.equal(duplicate.incluidos, 0);

  const descriptionIndex = exportedRows[0].indexOf('descricao');
  exportedRows[1][descriptionIndex] = 'Edição divergente';
  const conflictingCsv = `\uFEFF${exportedRows.map(csvLine).join('\r\n')}`;
  const conflict = await request('/sincronizacao/importar', {
    method: 'POST', token: auth, body: { nomeArquivo: 'conflito.csv', conteudo: conflictingCsv },
  });
  assert.equal(conflict.conflitos, 1);
  assert.match(conflict.detalhes[0].mensagem, /preservado/i);

  const history=await request('/historico',{token:auth});
  assert.ok(history.some((item)=>item.tipo==='lancamento'&&item.acao==='criado'));
  assert.ok(history.some((item)=>item.tipo==='sincronizacao'));

  await request('/usuarios',{method:'POST',token:auth,body:{nome:'Supervisor Teste',email:'supervisor@teste.local',senha:'senha-supervisor-123',role:'supervisor'}});
  const supervisor=(await request('/auth/login',{method:'POST',body:{email:'supervisor@teste.local',senha:'senha-supervisor-123'}})).token;
  await expectError('/fornecedores',{method:'POST',token:supervisor,body:{nome:'Não permitido'}},403);
  await expectError('/backup/restaurar',{method:'POST',token:auth,body:{confirmacao:'ERRADO'}},400);

  await request(`/lancamentos/${transaction.id}`, { method: 'DELETE', token: auth });
  await expectError(`/lancamentos/${transaction.id}`,{
    method:'PUT',token:auth,body:{...transactionBody,descricao:'Tentativa de reativação',revisao:updatedTransaction.revision+1},
  },409);
  const deletedExport = parseCsv(await raw('/sincronizacao/exportar.csv?sincronizar=1', auth));
  assert.equal(deletedExport[1][deletedExport[0].indexOf('excluido')], 'sim');
  const visible = await request('/lancamentos', { token: auth });
  assert.equal(visible.length, 0);

  const backup = await binary('/backup', auth);
  assert.ok(backup.length > 1024);
  assert.equal(backup[0], 0x1f);
  assert.equal(backup[1], 0x8b);
  const restore = await request('/backup/restaurar', {
    method:'POST',token:auth,body:{confirmacao:'RESTAURAR',nomeArquivo:'backup-teste.tar.gz',conteudoBase64:backup.toString('base64')},
  });
  assert.equal(restore.reinicioNecessario, true);
  assert.equal(fs.existsSync(path.join(process.env.RESTORE_ROOT_DIR,'restauracao-pendente.json')), true);

  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
  server = null;
  await initializeDatabase();
  const restoredUsers = await getDb().query('SELECT COUNT(*)::int AS total FROM users');
  const restoredSuppliers = await getDb().query('SELECT COUNT(*)::int AS total FROM suppliers');
  assert.equal(restoredUsers.rows[0].total, 2);
  assert.equal(restoredSuppliers.rows[0].total, 1);
  assert.equal(fs.existsSync(path.join(process.env.RESTORE_ROOT_DIR,'restauracao-pendente.json')), false);
  assert.ok(fs.readdirSync(tempRoot).some((entry)=>entry.startsWith('database-antes-restauracao-')));
  await closeDatabase();

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.ok, true, data.erro || `HTTP ${response.status}`);
    return data;
  }

  async function expectError(route,options,status){
    const response=await fetch(base+route,{method:options.method||'GET',headers:{...(options.token?{Authorization:`Bearer ${options.token}`}:{ }),'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});
    assert.equal(response.status,status);
  }

  async function raw(route, token) {
    const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.ok, true);
    return response.text();
  }

  async function binary(route, token) {
    const response = await fetch(base + route, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.ok, true);
    return Buffer.from(await response.arrayBuffer());
  }
});


