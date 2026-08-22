const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('frontend exibe código de suporte sem bloquear preenchimento manual', () => {
  assert.match(read('public/app.js'), /Código de suporte/);
  assert.match(read('public/v3-1-refinements.js'), /você ainda pode preencher os dados manualmente/);
});

test('falha D1 mantém diagnóstico interno e devolve mensagem segura', async () => {
  const db = require('../db');
  const originalIdentity = db.getInstanceIdentity;
  const originalFetch = global.fetch;
  const originalUrl = process.env.SYNC_API_URL;
  db.getInstanceIdentity = () => ({ id:'00000000-0000-4000-8000-000000000010', name:'Teste' });
  process.env.SYNC_API_URL = 'https://cloud.test';
  global.fetch = async () => new Response(JSON.stringify({ error:'D1_ERROR: no such table: clients' }), { status:500, headers:{ 'content-type':'application/json' } });
  delete require.cache[require.resolve('../services/cloudSync')];
  const cloud = require('../services/cloudSync');

  try {
    await assert.rejects(
      cloud.listClients({ email:'teste@rcconstrutec.com.br', cloud_session_token:'sessao-teste' }),
      (error) => error.statusCode === 502
        && /no such table: clients/.test(error.message)
        && /serviço corporativo/.test(error.publicMessage)
    );
  } finally {
    db.getInstanceIdentity = originalIdentity;
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SYNC_API_URL;
    else process.env.SYNC_API_URL = originalUrl;
    delete require.cache[require.resolve('../services/cloudSync')];
  }
});
