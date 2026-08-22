const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('Worker rejeita arquivo falso e aceita PDF real em base64', async () => {
  const source = read('cloudflare-sync-worker/src/index.js');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { validatePdfAttachments };`).toString('base64')}`);
  const valid = worker.validatePdfAttachments([{ filename:'nota.pdf', contentType:'application/pdf', contentBase64:Buffer.from('%PDF-1.7\n').toString('base64') }]);
  const invalid = worker.validatePdfAttachments([{ filename:'nota.pdf', contentType:'application/pdf', contentBase64:Buffer.from('arquivo falso').toString('base64') }]);

  assert.equal(valid.attachments.length, 1);
  assert.match(invalid.error, /nao parece ser um PDF valido/);
});

test('envio de cobrança busca a NF vinculada quando não recebe novo anexo', () => {
  const route = read('routes/cloudSync.js');
  assert.match(route, /if \(!attachments\.length\) attachments = await linkedInvoiceAttachments/);
  assert.match(route, /JOIN cost_centers c ON c\.id=i\.cost_center_id/);
});
