const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P5-P8 cria base de produtividade, rateio, bancos e backup automático',()=>{
  const sql=read('migrations/014_final_productivity_suite.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS saved_views/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS transaction_allocations/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS financial_accounts/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS bank_movements/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS backup_settings/);
});

test('P5 oferece sugestões, ações em massa, visões e rateio',()=>{
  const route=read('routes/productivity.js');
  assert.match(route,/\/sugestoes/);
  assert.match(route,/\/acoes-em-massa/);
  assert.match(route,/\/visoes/);
  assert.match(route,/\/rateio\/\:transactionId/);
});

test('P6 oferece contas e conciliação bancária com bloqueio de duplicidade',()=>{
  const route=read('routes/banking.js');
  const sql=read('migrations/014_final_productivity_suite.sql');
  assert.match(route,/\/contas/);
  assert.match(route,/\/importar/);
  assert.match(route,/\/sugestoes\/\:movementId/);
  assert.match(route,/\/conciliar\/\:movementId/);
  assert.match(sql,/bank_movements_source_hash_unique/);
});

test('P7 expõe central de atenção, fluxo de caixa, ABC e tendência',()=>{
  const route=read('routes/insights.js');
  assert.match(route,/\/atencao/);
  assert.match(route,/\/fluxo-caixa/);
  assert.match(route,/\/curva-abc/);
  assert.match(route,/\/tendencia-obras/);
});

test('P8 mantém backup automático com retenção e interface final',()=>{
  const service=read('services/autoBackup.js');
  const route=read('routes/backupAuto.js');
  const html=read('public/teste-chatgpt.html');
  const js=read('public/chatgpt-final.js');
  assert.match(service,/runAutoBackup/);
  assert.match(service,/enforceRetention/);
  assert.match(route,/\/executar/);
  assert.match(html,/chatgpt-final\.js/);
  assert.match(js,/Cockpit inteligente/);
  assert.match(js,/Cora/);
});

test('servidor conecta todos os módulos finais',()=>{
  const server=read('server.js');
  assert.match(server,/\/api\/produtividade/);
  assert.match(server,/\/api\/bancos/);
  assert.match(server,/\/api\/insights/);
  assert.match(server,/\/api\/backup-automatico/);
  assert.match(server,/startAutoBackup/);
});
