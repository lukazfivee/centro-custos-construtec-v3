const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sanitizarDiagnostico, lerAnexo } = require('../lib/bugReportDados');

// 1 pixel PNG valido.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('diagnóstico: só chaves conhecidas, 20 ações e nada de segredo ou valor', () => {
  const acoes = Array.from({ length: 30 }, (_, i) => ({ quando: '2026-10-04T10:00:00.000Z', acao: `Abriu a tela ${i}` }));
  acoes.push({ quando: '2026-10-04T10:01:00.000Z', acao: 'Senha: abc123' }, { quando: 'x', acao: 'Pagou R$ 1.234,56' }, { acao: 'Bearer abc.def.ghi' });
  const d = sanitizarDiagnostico({ versao: '3.4.2', navegador: 'Chrome 129', conexao: 'online', token: 'eyJhbGciOiJIUzI1NiJ9.segredo', senha: 'x', acoes });
  assert.equal(d.versao, '3.4.2');
  assert.equal(d.token, undefined);
  assert.equal(d.senha, undefined);
  assert.equal(d.acoes.length, 20);
  const texto = JSON.stringify(d);
  assert.doesNotMatch(texto, /abc123|1\.234|eyJ|Bearer/);
  assert.ok(d.acoes.some((a) => a.acao === '[removido]'));
  assert.equal(sanitizarDiagnostico(null), null);
  assert.throws(() => sanitizarDiagnostico('texto'), /Diagnóstico inválido/);
  assert.equal(sanitizarDiagnostico({ navegador: 'Bearer eyJhbGciOiJIUzI1NiJ9.aaaa.bbbb' }).navegador, '[removido]');
});

test('anexo: aceita imagem de verdade e recusa o resto', () => {
  const ok = lerAnexo({ nome: 'tela ../x.png', tipo: 'image/png', dados: `data:image/png;base64,${PNG}` });
  assert.equal(ok.tipo, 'image/png');
  assert.ok(ok.tamanho > 0);
  assert.doesNotMatch(ok.nome, /\//);
  assert.throws(() => lerAnexo({ tipo: 'application/pdf', dados: PNG }), /PNG, JPG/);
  assert.throws(() => lerAnexo({ tipo: 'image/png', dados: Buffer.from('nao e imagem').toString('base64') }), /não é uma imagem/);
  assert.throws(() => lerAnexo({ tipo: 'image/png' }), /Anexo inválido/);
  assert.equal(lerAnexo(null), null);
});

test('reports do desktop: diagnóstico, print, fila sem duplicar, resposta e permissões', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-reports-d7-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-reports-d7-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-reports-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-reports-d7@teste.local';
  process.env.REPORT_API_URL = '';
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

  const call = async (method, rota, token, body) => {
    const response = await fetch(base + rota, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  };
  const json = async (method, rota, token, body, status) => {
    const response = await call(method, rota, token, body);
    const data = await response.json();
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };

  const admin = (await json('POST', '/auth/login', null, { email: 'admin-reports-d7@teste.local', senha: 'senha-reports-123' }, 200)).token;
  await json('POST', '/usuarios', admin, { nome: 'Outra Pessoa', email: 'outra@teste.local', senha: 'senha-outra-12345', role: 'supervisor' }, 201);
  const outra = (await json('POST', '/auth/login', null, { email: 'outra@teste.local', senha: 'senha-outra-12345' }, 200)).token;

  const clientId = '3f1c2b7e-5d4a-4c8e-9a1b-0123456789ab';
  const corpo = {
    titulo: 'Botão de anexar não responde', descricao: 'No iPad, ao clicar em Anexar, nada acontece.', tipo: 'duvida', tela: 'Lançamentos · Documentos',
    client_id: clientId,
    diagnostico: { versao: '3.4.2', navegador: 'Chrome 129', conexao: 'online', senha: 'x', acoes: [{ quando: '2026-10-04T10:00:00.000Z', acao: 'Abriu Lançamentos' }, { acao: 'Senha 123' }] },
    anexo: { nome: 'tela.png', tipo: 'image/png', dados: PNG },
  };
  const criado = await json('POST', '/bug-reports', admin, corpo, 201);
  assert.equal(criado.tipo, 'duvida');
  assert.equal(criado.tela, 'Lançamentos · Documentos');
  assert.equal(criado.client_report_id, clientId);
  assert.equal(criado.tem_anexo, true);
  assert.equal(criado.tem_diagnostico, true);

  // Mesmo client_id (fila reenviando): não duplica e devolve 200.
  const repetido = await json('POST', '/bug-reports', admin, corpo, 200);
  assert.equal(repetido.id, criado.id);
  assert.equal(repetido.delivery.repetido, true);
  assert.equal((await getDb().query('SELECT id FROM bug_reports')).rows.length, 1);
  // Outra conta com o mesmo identificador: 409.
  const conflito = await json('POST', '/bug-reports', outra, { ...corpo, anexo: undefined }, 409);
  assert.match(conflito.erro, /identificador/i);

  // Detalhe traz o diagnóstico limpo; a lista só diz que tem.
  const detalhe = await json('GET', `/bug-reports/${criado.id}`, admin, null, 200);
  assert.equal(detalhe.diagnostico.versao, '3.4.2');
  assert.equal(detalhe.diagnostico.senha, undefined);
  assert.deepEqual(detalhe.diagnostico.acoes.map((a) => a.acao), ['Abriu Lançamentos', '[removido]']);
  const lista = await json('GET', '/bug-reports', admin, null, 200);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tem_diagnostico, true);
  assert.equal(lista[0].tem_anexo, true);
  assert.equal(lista[0].diagnostico, undefined);
  assert.equal(lista[0].author_email, 'admin-reports-d7@teste.local');

  // Print: bytes iguais e tipo de imagem; outra pessoa não vê.
  const anexo = await call('GET', `/bug-reports/${criado.id}/anexo`, admin);
  assert.equal(anexo.status, 200);
  assert.equal(anexo.headers.get('content-type'), 'image/png');
  assert.equal(anexo.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await anexo.arrayBuffer()), Buffer.from(PNG, 'base64'));
  assert.equal((await call('GET', `/bug-reports/${criado.id}/anexo`, outra)).status, 403);
  assert.equal((await call('GET', `/bug-reports/${criado.id}`, outra)).status, 403);
  assert.equal((await json('GET', '/bug-reports', outra, null, 200)).length, 0);

  // Validações, sempre em português no campo erro.
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: undefined, tipo: 'xyz' }, 400)).erro, /Tipo inválido/);
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: 'nao-e-uuid' }, 400)).erro, /Identificador do envio/);
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: undefined, anexo: { tipo: 'image/png', dados: Buffer.from('texto').toString('base64') } }, 400)).erro, /imagem/);
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: undefined, anexo: { tipo: 'text/html', dados: PNG } }, 400)).erro, /PNG, JPG/);
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: undefined, diagnostico: 'x' }, 400)).erro, /Diagnóstico inválido/);
  assert.match((await json('POST', '/bug-reports', outra, { ...corpo, client_id: undefined, tela: 'a'.repeat(121) }, 400)).erro, /onde aconteceu/);
  const sem = await json('POST', '/bug-reports', outra, { titulo: 'Sem extras', descricao: 'Sem diagnóstico nem print.', tipo: 'sugestao' }, 201);
  assert.equal(sem.tem_anexo, false);
  assert.equal(sem.tem_diagnostico, false);
  assert.match((await json('GET', `/bug-reports/${sem.id}/anexo`, outra, null, 404)).erro, /não tem print/);

  // Resposta da equipe: só admin ou gestor; quem enviou lê.
  assert.equal((await call('PUT', `/bug-reports/${sem.id}`, outra, { resposta: 'Eu mesmo' })).status, 403);
  const respondido = await json('PUT', `/bug-reports/${sem.id}`, admin, { resposta: 'Entrou na lista de melhorias', status: 'em andamento' }, 200);
  assert.equal(respondido.resposta_equipe, 'Entrou na lista de melhorias');
  assert.ok(respondido.respondido_em);
  assert.equal((await json('GET', `/bug-reports/${sem.id}`, outra, null, 200)).resposta_equipe, 'Entrou na lista de melhorias');

  // Entrega: sem endpoint central o report continua na fila e o status conta certo.
  const status = await json('GET', '/bug-reports/delivery/status', admin, null, 200);
  assert.equal(status.configured, false);
  assert.equal(status.pending, 1);
});

test('reports do desktop: tela registrada, fila no navegador e botão antigo fora', () => {
  const raiz = path.join(__dirname, '..', 'public', 'd');
  const index = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  for (const arquivo of ['diagnostico', 'telas/reports-fila', 'telas/reports-form', 'telas/reports-ver', 'telas/reports']) assert.ok(index.includes(`${arquivo}.js`), `${arquivo}.js fora do index`);
  assert.ok(index.includes('css/reports.css'));
  assert.ok(fs.readFileSync(path.join(raiz, 'telas', 'reports.js'), 'utf8').includes("D.tela('reports'"));
  const fila = fs.readFileSync(path.join(raiz, 'telas', 'reports-fila.js'), 'utf8');
  assert.match(fila, /BANCO = 'cc-desktop-reports'/);
  assert.match(fila, /indexedDB\.open\(BANCO/);
  assert.match(fila, /addEventListener\('online'/);
  assert.doesNotMatch(index + fila, /report-v2|bugreport-form|report-consent/);
});
