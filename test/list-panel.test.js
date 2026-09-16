const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('index carrega o painel de listas e a camada de feedback assincrono', () => {
  const html = read('public/index.html');
  assert.match(html, /list-panel\.css/);
  assert.match(html, /list-panel\.js/);
  assert.match(html, /list-panel-lists\.js/);
  // Ordem: o nucleo do painel antes das especificações.
  assert.ok(html.indexOf('list-panel.js') < html.indexOf('list-panel-lists.js'));
});

test('painel de listas pede paginacao, tamanho de pagina e preserva estado', () => {
  const script = read('public/list-panel.js');
  assert.match(script, /paginar: '1'/);
  assert.match(script, /pagina: String\(value\.pagina\)/);
  assert.match(script, /limite: String\(value\.limite\)/);
  assert.match(script, /\[25, 50, 100, 200\]/);
  assert.match(script, /sessionStorage\.setItem/);
  assert.match(script, /sessionStorage\.getItem/);
});

test('painel de listas cobre loading, vazio, erro e retry', () => {
  const script = read('public/list-panel.js');
  assert.match(script, /cc-list-error/);
  assert.match(script, /data-cc-list-retry/);
  assert.match(script, /Carregando/);
  assert.match(script, /stateMarkup\('empty'/);
});

test('painel de listas oferece rotulos acessiveis e navegacao por teclado', () => {
  const script = read('public/list-panel.js');
  assert.match(script, /aria-label="Registros por página/);
  assert.match(script, /aria-live="polite"/);
  assert.match(script, /aria-busy/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /role="group"/);
});

test('as seis listas estao registradas no painel', () => {
  const lists = read('public/list-panel-lists.js');
  for (const name of ['categorias', 'fornecedores', 'centros', 'historico', 'recorrentes', 'usuarios']) {
    assert.match(lists, new RegExp(`name: '${name}'`));
  }
  assert.match(lists, /loaderName: 'loadCategories'/);
  assert.match(lists, /loaderName: 'loadSuppliers'/);
  assert.match(lists, /loaderName: 'loadCenters'/);
  assert.match(lists, /loaderName: 'loadHistory'/);
});

test('index resolve os loaders via window para permitir paginacao externa', () => {
  const script = read('public/app.js');
  assert.match(script, /dashboard:window\.loadDashboard\|\|loadDashboard/);
  assert.match(script, /fornecedores:window\.loadSuppliers\|\|loadSuppliers/);
  assert.match(script, /categorias:window\.loadCategories\|\|loadCategories/);
  assert.match(script, /historico:window\.loadHistory\|\|loadHistory/);
});

test('endpoints de lista usam paginacao retrocompativel do backend', () => {
  const files = {
    categories: read('routes/categories.js'),
    suppliers: read('routes/suppliers.js'),
    history: read('routes/history.js'),
    recurring: read('routes/recurring.js'),
    users: read('routes/users.js'),
    costCenters: read('routes/costCenters.js'),
  };
  for (const [name, source] of Object.entries(files)) {
    assert.match(source, /require\('\.\.\/lib\/pagination'\)/, `${name} deve importar lib/pagination`);
    assert.match(source, /wantsPagination/, `${name} deve decidir paginação`);
    assert.match(source, /paginationMeta/, `${name} deve devolver metadados`);
    assert.match(source, /X-Total-Count/, `${name} deve expor total`);
  }
});
