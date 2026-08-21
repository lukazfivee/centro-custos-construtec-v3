const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('migração P2 preserva valor positivo e adiciona sinal e vínculo de estorno', () => {
  const sql = read('migrations/011_transaction_reversals.sql');
  assert.match(sql, /accounting_sign SMALLINT NOT NULL DEFAULT 1/);
  assert.match(sql, /reversal_of UUID REFERENCES transactions\(public_id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX transactions_single_reversal_idx/);
  assert.match(sql, /accounting_sign = -1/);
});

test('API P2 cria estorno compensatório e protege o histórico', () => {
  const route = read('routes/transactions.js');
  assert.match(route, /router\.post\('\/:id\/estornar'/);
  assert.match(route, /accounting_sign,reversal_of,reversal_reason/);
  assert.match(route, /VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,-1/);
  assert.match(route, /action:'estornado'/);
  assert.match(route, /Este lançamento já foi estornado/);
  assert.match(route, /Movimentos de estorno não podem ser excluídos/);
});

test('indicadores financeiros usam o sinal contábil dos estornos', () => {
  const dashboard = read('routes/dashboard.js');
  const centers = read('routes/costCenters.js');
  assert.match(dashboard, /amount \* accounting_sign/);
  assert.match(dashboard, /t\.amount \* t\.accounting_sign/);
  assert.match(centers, /t\.amount \* t\.accounting_sign/);
});

test('entrada de teste mantém interface e fluxo de estorno P2 nas versões seguintes', () => {
  const html = read('public/teste-chatgpt.html');
  const script = read('public/chatgpt-p2.js');
  const batch = read('TESTAR-VERSAO-CHATGPT.bat');
  assert.match(html, /chatgpt-p2\.css/);
  assert.match(html, /chatgpt-p2\.js/);
  assert.match(script, /Confirmar estorno/);
  assert.match(script, /\/api\/lancamentos\/\$\{item\.id\}\/estornar/);
  assert.match(batch, /estorno/i);
  assert.match(batch, /P[2-9]/);
});

test('sincronização antiga é bloqueada após estornos para evitar perda de vínculo', () => {
  const sync = read('routes/sync.js');
  assert.match(sync, /accounting_sign=-1 OR reversal_of IS NOT NULL/);
  assert.match(sync, /sincronização CSV antiga foi bloqueada/);
});
