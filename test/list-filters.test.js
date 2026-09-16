const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'list-filters.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const filters = context.window.ListFilters;

test('filtra transações sem acentos e soma centavos excluindo canceladas', () => {
  const items = [
    { descricao: 'Compra de Café', tipo: 'despesa', valor: '10,10', situacao: 'liquidado' },
    { descricao: 'Café cancelado', tipo: 'despesa', valor: '99,99', situacao: 'cancelado' },
    { descricao: 'Venda', tipo: 'receita', valor: '20.05', situacao: 'liquidado' }
  ];
  const result = filters.filterTransactions(items, { busca: 'cafe' });
  assert.equal(result.length, 2);
  assert.equal(filters.sumTransactionsCents(result), -1010);
});

test('aplica status nas três listagens cadastrais', () => {
  assert.equal(filters.filterCenters([{ ativo: false, nome: 'Obra A' }, { ativo: true, situacao: 'execucao', nome: 'Obra B' }], { status: 'inativo' }).length, 1);
  assert.equal(filters.filterCategories([{ nome: 'Receita', tipo: 'receita' }, { nome: 'Custo', tipo: 'despesa' }], { tipo: 'despesa' }).length, 1);
  assert.equal(filters.filterSuppliers([{ nome: 'Alpha', ativo: true }, { nome: 'Beta', ativo: false }], { status: 'ativo' }).length, 1);
});
