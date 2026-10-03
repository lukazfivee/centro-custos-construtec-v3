const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'm', file), 'utf8');

test('celular: tres pontos da obra com excluir (sem vinculo) e descartar (com vinculo, so admin)', () => {
  const obra = read('screen-obra.js');
  const acoes = read('screen-obra-acoes.js');
  assert.match(obra, /id="obra-mais"/);
  assert.match(obra, /CC\.obraMenu\(c\)/);
  assert.match(acoes, /const canDel = !linked && \(r === 'admin' \|\| r === 'gestor'\)/);
  assert.match(acoes, /const canDesc = linked && r === 'admin'/);
  assert.match(acoes, /method: 'DELETE'/);
  assert.match(acoes, /\/descartar`, \{ method: 'POST', body: \{ confirmar:/);
  assert.match(acoes, /\/impedimentos`/);
  assert.match(acoes, /volta a "Aprovada sem Centro de Custo" no Orçamentos e volta a apontar para a obra/);
  assert.match(acoes, /go\.disabled = !ok\(\)/, 'botao so libera com o codigo');
  assert.match(acoes, /Nada foi alterado/);
});

test('celular: Obras descartadas so para admin, com lista, detalhe e recuperar', () => {
  const menu = read('screen-misc.js');
  const desc = read('screen-descartadas.js');
  assert.match(menu, /CC\.isAdmin\(\) && CC\.screens\.descartadas/);
  assert.match(desc, /CC\.screens\.descartadas = /);
  assert.match(desc, /CC\.screens\.descartada = /);
  assert.match(desc, /\/restaurar`, \{ method: 'POST'/);
  assert.match(desc, /Nenhuma obra descartada/);
  assert.match(desc, /CC\.cached\('descartadas'/, 'lista abre sem internet com a ultima copia');
  const sw = read('sw.js');
  assert.match(sw, /'screen-obra-acoes\.js'/);
  assert.match(sw, /'screen-descartadas\.js'/);
});
