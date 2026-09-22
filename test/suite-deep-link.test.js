const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('abre a obra indicada pela suíte após autenticação', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(source, /URLSearchParams\(location\.hash\.slice\(1\)\)\.get\('obra'\)/);
  assert.match(source, /showView\('centros'\);await openCenterDetail\(centerId\)/);
});

test('saúde integrada aceita somente origens locais', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(source, /Access-Control-Allow-Origin/);
});

test('CSP permite o Orçamentos local como frame pai', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'observability.js'), 'utf8');
  assert.match(source, /frame-ancestors 'self' http:\/\/localhost:5173/);
});
