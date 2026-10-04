const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { iniciar } = require('../scripts/dev/fake-commercial-worker');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('assinatura')]).toString('base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto')]).toString('base64');
const PDF = Buffer.from('%PDF-1.4 nfse 77').toString('base64');

test('Servicos curtos: faturar (cobranca na nuvem e NFS-e) e descarte/restauracao com os dados do servico', async (context) => {
  const obras = [];
  const worker = await iniciar({ obras });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-servicos-fat-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'servicos-faturar-secret-with-32-chars-min';
  process.env.ADMIN_INITIAL_PASSWORD = 'servicos-fat-123';
  process.env.ADMIN_INITIAL_EMAIL = 'fat@teste.local';
  process.env.SYNC_API_URL = worker.url;
  process.env.SYNC_SHARED_KEY = 'chave-de-teste';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await worker.fechar();
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.SYNC_API_URL;
    delete process.env.SYNC_SHARED_KEY;
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
  const admin = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fat@teste.local', senha: 'servicos-fat-123' }) })).json()).token;
  await request('/usuarios', 'POST', { nome: 'Gestora', email: 'gestora@rcconstrutec.com.br', senha: 'senha-gestora-1', role: 'gestor' }, 201);
  await request('/usuarios', 'POST', { nome: 'Tecnico', email: 'tec2@teste.local', senha: 'senha-tecnico-1', role: 'supervisor' }, 201);
  const jwt = require('jsonwebtoken');
  const tokenDe = async (email) => {
    const { rows } = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    return jwt.sign({}, process.env.JWT_SECRET, { subject: String(rows[0].id), expiresIn: '1h' });
  };
  const gestor = await tokenDe('gestora@rcconstrutec.com.br');
  const tec = await tokenDe('tec2@teste.local');

  await context.test('faturar: so concluido, valida forma e vencimento, cria a cobranca e o servico vira faturado', async () => {
    const s = await request('/servicos', 'POST', { cliente: 'Padaria Boa', valor: 800, descricao: 'Remanejar rack' }, 201);
    const publicId = (await db.query('SELECT public_id FROM cost_centers WHERE id=$1', [s.id])).rows[0].public_id;
    obras.push({ publicId, code: s.codigo, name: s.nome, client: 'Padaria Boa', contractAmount: 800, projectStatus: 'execucao' });
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'pix', vencimentoDias: 10 }, 409, gestor);
    await request(`/servicos/${s.id}/concluir`, 'POST', { comPendencias: true }, 200, gestor);
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'pix' }, 403, tec);
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'cheque', vencimentoDias: 10 }, 400, gestor);
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'pix', vencimentoDias: -1 }, 400, gestor);
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'pix', nfse: { numero: '77', arquivo: { nome: 'nf.pdf', conteudoBase64: JPG } } }, 400, gestor);
    const out = await request(`/servicos/${s.id}/faturar`, 'POST', { valor: 820, vencimentoDias: 10, forma: 'boleto',
      nfse: { numero: 'NFS-e 77', arquivo: { nome: 'nfse-77.pdf', conteudoBase64: PDF } } }, 200, gestor);
    assert.equal(out.situacao, 'faturado');
    assert.equal(out.faturamento.valor, 820);
    assert.equal(out.faturamento.forma, 'boleto');
    assert.equal(out.faturamento.nfseArquivo, true);
    assert.match(out.faturamento.vencimento, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(out.cobranca, { sincronizada: true, motivo: null });
    // A cobranca do modulo Cobrancas foi atualizada (Worker comercial).
    const list = await request('/cloud-sync/cobrancas', 'GET', undefined, 200, gestor);
    const item = list.items.find((i) => i.publicId === publicId);
    assert.equal(item.financialStatus, 'nf_emitida');
    assert.equal(item.invoiceNumber, 'NFS-e 77');
    assert.equal(item.receivableAmount, 820);
    assert.equal(item.dueDate, out.faturamento.vencimento);
    assert.match(item.notes, /Boleto/);
    // A NFS-e fica como NF vinculada da obra (o envio de Cobrancas anexa esse PDF).
    const nf = (await db.query('SELECT original_name FROM cost_center_invoices WHERE cost_center_id=$1', [s.id])).rows[0];
    assert.equal(nf.original_name, 'nfse-77.pdf');
    await request(`/servicos/${s.id}/faturar`, 'POST', { forma: 'pix' }, 409, gestor);
    await request(`/servicos/${s.id}/checklist`, 'PUT', { itens: [{ texto: 'x' }] }, 409, gestor);
    await request(`/servicos/${s.id}/situacao`, 'PUT', { situacao: 'em_andamento' }, 409, gestor);
    const d = await request(`/servicos/${s.id}`, 'GET', undefined, 200, gestor);
    assert.equal(d.faturamento.cobrancaSincronizada, true);
    const dt = await request(`/servicos/${s.id}`, 'GET', undefined, 200, tec);
    assert.equal(dt.faturamento.valor, undefined);
    assert.ok((await db.query("SELECT 1 FROM audit_log WHERE entity_type='servico' AND action='faturado'")).rows.length);
  });

  await context.test('faturar sem conta corporativa: fatura localmente e avisa que a cobranca nao foi atualizada', async () => {
    const s = await request('/servicos', 'POST', { cliente: 'Escola', valor: 450 }, 201);
    await request(`/servicos/${s.id}/concluir`, 'POST', { comPendencias: true });
    const out = await request(`/servicos/${s.id}/faturar`, 'POST', { vencimentoDias: 0, forma: 'transferencia' });
    assert.equal(out.situacao, 'faturado');
    assert.equal(out.faturamento.valor, 450);
    assert.equal(out.cobranca.sincronizada, false);
    assert.match(out.cobranca.motivo, /rcconstrutec/);
  });

  await context.test('descarte e restauracao levam checklist, fotos, aceite e situacao', async () => {
    const s = await request('/servicos', 'POST', { cliente: 'Clinica', valor: 600, local: 'Av. C, 5' }, 201);
    await request(`/servicos/${s.id}/situacao`, 'PUT', { situacao: 'em_andamento' });
    await request(`/servicos/${s.id}/checklist`, 'PUT', { itens: [{ texto: 'Passar cabo', feito: true }] });
    await request(`/servicos/${s.id}/fotos`, 'POST', { fase: 'antes', nome: 'a.jpg', conteudoBase64: JPG }, 201);
    await request(`/servicos/${s.id}/aceite`, 'PUT', { nome: 'Dra. Ana', cargo: 'Diretora', assinatura: { conteudoBase64: PNG } });
    const disc = await request(`/centros-custo/${s.id}/descartar`, 'POST', { confirmar: s.codigo, motivo: 'teste' });
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM service_jobs WHERE cost_center_id=$1', [s.id])).rows[0].n, 0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM service_photos WHERE cost_center_id=$1', [s.id])).rows[0].n, 0);
    await request(`/servicos/${s.id}`, 'GET', undefined, 404);
    await request(`/centros-custo/descartadas/${disc.descarte}/restaurar`, 'POST', {});
    const back = await request(`/servicos/${s.id}`);
    assert.equal(back.situacao, 'em_andamento');
    assert.equal(back.local, 'Av. C, 5');
    assert.deepEqual(back.checklist.map((i) => [i.texto, i.feito]), [['Passar cabo', true]]);
    assert.equal(back.fotos.length, 1);
    assert.equal(back.aceite.nome, 'Dra. Ana');
    const sig = await fetch(`${base}/servicos/${s.id}/aceite/assinatura`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(Buffer.from(await sig.arrayBuffer()).toString('base64'), PNG);
    const photo = await fetch(`${base}${back.fotos[0].url.replace('/api', '')}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(Buffer.from(await photo.arrayBuffer()).toString('base64'), JPG);
  });
});
