const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const D1_TABLES = {
  clients:['id','org_id','company','name','email','active','created_by_email','updated_by_email','created_at','updated_at'],
  client_followups:['org_id','cost_center_public_id','client_name','client_emails','responsible','operational_status','financial_status','invoice_number','contract_amount','receivable_amount','completion_date','due_date','notes','updated_by_email','updated_at'],
  client_email_drafts:['org_id','cost_center_public_id','to_json','cc_json','subject','body_text','status','authorized_by_email','authorized_at','sent_by_email','sent_at','resend_email_id','last_error','attachments_json','updated_at'],
  client_email_events:['id','org_id','cost_center_public_id','action','actor_email','recipients_json','attachments_json','detail','created_at'],
};

function tableDefinition(sql, table) {
  return sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] || '';
}

test('migration D1 de clientes contém os campos usados pelo Worker', () => {
  const schema = read('cloudflare-sync-worker/schema.sql');
  const migrations = `${read('cloudflare-sync-worker/migrations/003-cobrancas.sql')}\n${read('cloudflare-sync-worker/migrations/004-clientes.sql')}`;
  for (const [table, fields] of Object.entries(D1_TABLES)) {
    const schemaTable = tableDefinition(schema, table);
    const migrationTable = tableDefinition(migrations, table);
    assert.ok(schemaTable, `tabela ${table} ausente do schema`);
    assert.ok(migrationTable, `tabela ${table} ausente das migrations`);
    for (const field of fields) {
      assert.match(schemaTable, new RegExp(`\\b${field}\\b`));
      assert.match(migrationTable, new RegExp(`\\b${field}\\b`));
    }
  }
  assert.match(migrations, /clients_org_email_unique/);
});

test('Worker recompõe tabelas comerciais ausentes antes de atender as rotas', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { ensureCommercialSchema };`).toString('base64')}`);
  const prepared = [];
  const env = { DB:{
    prepare(sql) { prepared.push(sql); return { sql }; },
    async batch(statements) { return statements; },
  } };

  await worker.ensureCommercialSchema(env);
  for (const table of Object.keys(D1_TABLES)) {
    assert.ok(prepared.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)), `tabela ${table} não foi protegida`);
  }
});

test('Worker rejeita arquivo falso e aceita PDF real em base64', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { validatePdfAttachments };`).toString('base64')}`);
  const valid = worker.validatePdfAttachments([{ filename:'nota.pdf', contentType:'application/pdf', contentBase64:Buffer.from('%PDF-1.7\n').toString('base64') }]);
  const invalid = worker.validatePdfAttachments([{ filename:'nota.pdf', contentType:'application/pdf', contentBase64:Buffer.from('arquivo falso').toString('base64') }]);
  const missing = worker.validatePdfAttachments([]);
  assert.equal(missing.status, 409);

  assert.equal(valid.attachments.length, 1);
  assert.match(invalid.error, /nao parece ser um PDF valido/);
});

test('envio de cobrança busca a NF vinculada quando não recebe novo anexo', () => {
  const route = read('routes/cloudSync.js');
  assert.match(route, /if \(!attachments\.length\) attachments = await linkedInvoiceAttachments/);
  assert.match(route, /JOIN cost_centers c ON c\.id=i\.cost_center_id/);
});

test('envio atualiza apenas a situação elegível e preserva pagamento e valores recentes', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { markFollowupSent };`).toString('base64')}`);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE sync_entities (org_id TEXT, entity_type TEXT, public_id TEXT, payload TEXT)');
    db.exec(`CREATE TABLE client_followups (${tableDefinition(read('cloudflare-sync-worker/schema.sql'), 'client_followups')});`);
    const id = '11111111-1111-4111-8111-111111111111';
    db.prepare('INSERT INTO sync_entities VALUES (?,?,?,?)').run('org', 'obra', id, JSON.stringify({ client:'Cliente', contractAmount:100 }));
    const env = { DB: { prepare(sql) {
      const statement = db.prepare(sql);
      return { bind(...args) { return {
        first: async () => statement.get(...args),
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      }; } };
    } } };
    const auth = { user: { org_id:'org', email:'gestor@rcconstrutec.com.br' } };
    const sent = () => worker.markFollowupSent(env, auth, id, '2026-09-29T12:00:00Z');
    const get = () => db.prepare('SELECT financial_status,receivable_amount,notes FROM client_followups WHERE cost_center_public_id=?').get(id);
    await sent();
    assert.equal(get().financial_status, 'aguardando_pagamento');
    assert.equal(get().receivable_amount, 100);
    db.prepare("UPDATE client_followups SET financial_status='pago',receivable_amount=500,notes='pagamento registrado'").run();
    await sent();
    assert.deepEqual({ ...get() }, { financial_status:'pago', receivable_amount:500, notes:'pagamento registrado' });
    db.prepare("UPDATE client_followups SET financial_status='nf_emitida'").run();
    await sent();
    assert.deepEqual({ ...get() }, { financial_status:'aguardando_pagamento', receivable_amount:500, notes:'pagamento registrado' });
  } finally { db.close(); }
});

test('envios concorrentes usam uma autorização só e preservam pagamento recente', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { handleSendDraft, handleSaveDraft, handleAuthorizeDraft };`).toString('base64')}`);
  const db = new DatabaseSync(':memory:');
  const oldFetch = global.fetch;
  let sent = 0;
  try {
    const schema = read('cloudflare-sync-worker/schema.sql');
    for (const table of ['client_followups', 'client_email_drafts', 'client_email_events']) db.exec(`CREATE TABLE ${table} (${tableDefinition(schema, table)});`);
    db.exec('CREATE TABLE sync_entities (org_id TEXT,entity_type TEXT,public_id TEXT,payload TEXT)');
    db.exec('CREATE TABLE cloud_users (id TEXT,org_id TEXT,email TEXT,role TEXT,active INTEGER)');
    db.exec('CREATE TABLE cloud_sessions (token_hash TEXT,user_id TEXT,org_id TEXT,expires_at INTEGER,last_seen_at TEXT)');
    const id = '11111111-1111-4111-8111-111111111111';
    const token = 'token-de-teste';
    db.prepare('INSERT INTO cloud_users VALUES (?,?,?,?,?)').run('u1', 'org', 'gestor@rcconstrutec.com.br', 'gestor', 1);
    db.prepare('INSERT INTO cloud_sessions VALUES (?,?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), 'u1', 'org', Math.floor(Date.now()/1000)+3600, '');
    db.prepare('INSERT INTO sync_entities VALUES (?,?,?,?)').run('org', 'obra', id, JSON.stringify({ client:'Cliente', contractAmount:100 }));
    db.prepare("INSERT INTO client_followups (org_id,cost_center_public_id,financial_status,receivable_amount,updated_at) VALUES (?,?,?,? ,?)")
      .run('org', id, 'pago', 500, '2026-09-29T10:00:00Z');
    db.prepare("INSERT INTO client_email_drafts (org_id,cost_center_public_id,to_json,cc_json,subject,body_text,status,authorized_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run('org', id, '["cliente@exemplo.com.br"]', '[]', 'Cobrança', 'Segue a nota fiscal.', 'authorized', '2026-09-29T11:00:00Z', '2026-09-29T11:00:00Z');
    const env = { RESEND_API_KEY:'teste', CLIENT_EMAIL_FROM:'financeiro@rcconstrutec.com.br', DB: { prepare(sql) {
      const statement = db.prepare(sql);
      return { bind(...args) { return {
        first: async () => statement.get(...args),
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      }; } };
    } } };
    global.fetch = async (_url, options) => {
      sent++;
      assert.match(options.headers['Idempotency-Key'], new RegExp(id));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ id:'resend-1' });
    };
    const pdf = Buffer.from('%PDF-1.4 teste').toString('base64');
    const request = () => new Request('https://exemplo.test/v1/client-email-draft/send', {
      method:'POST', headers:{ Authorization:`Bearer ${token}` },
      body:JSON.stringify({ costCenterPublicId:id, attachments:[{ filename:'nota.pdf', contentType:'application/pdf', contentBase64:pdf }] }),
    });
    const responses = await Promise.all([worker.handleSendDraft(request(), env), worker.handleSendDraft(request(), env)]);
    const codes = responses.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 409]);
    assert.equal(sent, 1);
    assert.equal(db.prepare('SELECT status FROM client_email_drafts').get().status, 'sent');
    assert.equal(db.prepare('SELECT financial_status FROM client_followups').get().financial_status, 'pago');
    db.prepare("UPDATE client_email_drafts SET status='sending'").run();
    const writeRequest = (path, body) => new Request(`https://exemplo.test${path}`, {
      method:'POST', headers:{ Authorization:`Bearer ${token}` }, body:JSON.stringify({ costCenterPublicId:id, ...body }),
    });
    assert.equal((await worker.handleSaveDraft(writeRequest('/v1/client-email-draft', { to:['cliente@exemplo.com.br'], subject:'Cobrança', bodyText:'Segue a nota fiscal.' }), env)).status, 409);
    assert.equal((await worker.handleAuthorizeDraft(writeRequest('/v1/client-email-draft/authorize', { confirmar:true }), env)).status, 409);
    assert.equal(db.prepare('SELECT status FROM client_email_drafts').get().status, 'sending');
    db.prepare("UPDATE client_email_drafts SET status='authorized',authorized_at='2026-09-20T12:00:00Z'").run();
    const keys = [];
    global.fetch = async (_url, options) => { keys.push(options.headers['Idempotency-Key']); throw new Error('rede indisponível'); };
    const uncertain = await worker.handleSendDraft(request(), env);
    assert.equal(uncertain.status, 502);
    assert.equal(db.prepare('SELECT status FROM client_email_drafts').get().status, 'sending');
    assert.equal((await worker.handleSendDraft(request(), env)).status, 409);
    db.prepare('UPDATE client_email_drafts SET updated_at=?').run(new Date(Date.now() - 2 * 60 * 1000).toISOString());
    global.fetch = async (_url, options) => { keys.push(options.headers['Idempotency-Key']); return Response.json({ id:'resend-2' }); };
    assert.equal((await worker.handleSendDraft(request(), env)).status, 200);
    assert.equal(db.prepare('SELECT status FROM client_email_drafts').get().status, 'sent');
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
  } finally { global.fetch = oldFetch; db.close(); }
});
