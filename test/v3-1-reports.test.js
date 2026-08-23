const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Report V2 distingue aceite do provedor e entrega confirmada', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(),'centro-custos-reports-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot,'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot,'restore');
  process.env.JWT_SECRET = 'segredo-reports-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-reports-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-reports@teste.local';
  process.env.REPORT_API_URL = '';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  const delivery = require('../services/reportDelivery');
  const httpFetch = global.fetch;
  await initializeDatabase();
  const server = createApp().listen(0,'127.0.0.1');
  await new Promise((resolve)=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    global.fetch = httpFetch;
    process.env.REPORT_API_URL = '';
    if (server.listening) await new Promise((resolve)=>server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot,{recursive:true,force:true});
  });

  async function request(route,{method='GET',token,body}={}) {
    const response = await httpFetch(base+route,{
      method,
      headers:{ ...(token?{Authorization:`Bearer ${token}`} : {}), ...(body?{'content-type':'application/json'}:{}) },
      body:body?JSON.stringify(body):undefined,
    });
    const data = await response.json();
    assert.ok(response.ok,JSON.stringify(data));
    return data;
  }

  const login = await request('/auth/login',{method:'POST',body:{email:'admin-reports@teste.local',senha:'senha-reports-123'}});
  const report = await request('/bug-reports',{method:'POST',token:login.token,body:{titulo:'Falha offline de teste',descricao:'Descrição suficiente para validar a fila.',tipo:'bug',severidade:'media'}});
  assert.equal(report.delivery.status,'pending');
  assert.equal(report.delivery.queued,true);

  const status = await request('/bug-reports/delivery/status',{token:login.token});
  assert.equal(status.configured,false);
  assert.equal(status.pending,1);
  const retryWithoutEndpoint = await request('/bug-reports/delivery/retry',{method:'POST',token:login.token});
  assert.equal(retryWithoutEndpoint.delivered,0);

  process.env.REPORT_API_URL = 'https://reports.test';
  global.fetch = async () => { throw new TypeError('sem conexão'); };
  const offline = await delivery.deliverReport(report.id);
  assert.equal(offline.status,'pending');

  let centralPayload;
  global.fetch = async (url,options = {}) => {
    if (String(url).endsWith('/status')) {
      return new Response(JSON.stringify({ok:true,reportId:'CENTRAL-TESTE-1',emailStatus:'delivered'}),{status:200,headers:{'content-type':'application/json'}});
    }
    centralPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ok:true,reportId:'CENTRAL-TESTE-1',emailStatus:'sent'}),{status:201,headers:{'content-type':'application/json'}});
  };
  const sent = await delivery.deliverReport(report.id);
  assert.equal(sent.status,'accepted');
  assert.equal(centralPayload.user.email,'admin-reports@teste.local');
  assert.equal(centralPayload.title,'Falha offline de teste');

  const confirmed = await delivery.refreshReportStatus(report.id);
  assert.equal(confirmed.status,'delivered');

  const saved = (await getDb().query('SELECT delivery_status,delivery_attempts,central_report_id FROM bug_reports WHERE id=$1',[report.id])).rows[0];
  assert.equal(saved.delivery_status,'delivered');
  assert.equal(saved.delivery_attempts,2);
  assert.equal(saved.central_report_id,'CENTRAL-TESTE-1');
});

test('login oferece controle acessível para mostrar e ocultar senha', () => {
  const html = fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const app = fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  assert.match(html, /id="toggle-login-password"[^>]+aria-controls="login-senha"[^>]+aria-pressed="false"/);
  assert.match(app, /input\.type=visible\?'text':'password'/);
  assert.match(app, /visible\?'Ocultar':'Mostrar'/);
});

test('consentimento de privacidade também protege o formulário V2', () => {
  const source = fs.readFileSync(path.join(__dirname,'..','public','report-consent.js'),'utf8');
  assert.match(source, /#bugreport-form, #report-v2-form/);
  assert.match(source, /nome, e-mail e o texto informado/);
});
