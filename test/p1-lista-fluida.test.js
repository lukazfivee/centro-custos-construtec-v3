const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('entrada de teste P1 injeta os recursos sem alterar o index principal', () => {
  const html = read('public/teste-chatgpt.html');
  assert.match(html, /src="\/"/);
  assert.match(html, /chatgpt-p1\.css/);
  assert.match(html, /chatgpt-p1\.js/);
});

test('lista P1 solicita paginação e mantém limites aceitos pela API', () => {
  const script = read('public/chatgpt-p1.js');
  assert.match(script, /params\.set\('paginar','1'\)/);
  assert.match(script, /params\.set\('pagina'/);
  assert.match(script, /params\.set\('limite'/);
  assert.match(script, /\[25,50,100,200\]/);
  assert.match(script, /requestSequence/);
});

test('inicializador de teste abre a interface P1 na porta isolada', () => {
  const batch = read('TESTAR-VERSAO-CHATGPT.bat');
  assert.match(batch, /127\.0\.0\.1:3334\/teste-chatgpt\.html/);
  assert.match(batch, /Nenhum dado da versao principal sera alterado/);
});
