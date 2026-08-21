const test = require('node:test');
const assert = require('node:assert/strict');
const { csvLine, parseCsv } = require('../lib/csv');
const { validDate, validMonth, monthRange, monthsEndingAt } = require('../lib/dates');
const { buildTransactionFilters } = require('../lib/transactionFilters');
const { parseMoney, sameBusinessData, HEADERS } = require('../services/sync');

test('CSV preserva ponto e vírgula, aspas e quebra de linha', () => {
  const values = ['texto; composto', 'uma "aspas"', 'linha 1\nlinha 2', 'simples'];
  assert.deepEqual(parseCsv(`${csvLine(values)}\r\n`), [values]);
});

test('formato de sincronização contém identidade, revisão e exclusão', () => {
  for (const column of ['id_lancamento', 'origem_id', 'alterado_na_instalacao_id', 'revisao', 'alterado_em', 'excluido']) {
    assert.ok(HEADERS.includes(column), `coluna ausente: ${column}`);
  }
});

test('datas e intervalos mensais são validados sem ambiguidade', () => {
  assert.equal(validDate('2026-02-28'), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validMonth('2026-08'), true);
  assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  assert.deepEqual(monthsEndingAt('2026-03', 3), ['2026-01', '2026-02', '2026-03']);
});

test('filtros ocultam excluídos normalmente e permitem exportar tombstones', () => {
  const regular = buildTransactionFilters({ tipo: 'despesa', mes: '2026-08' });
  assert.match(regular.where, /deleted_at IS NULL/);
  assert.deepEqual(regular.values, ['despesa', '2026-08-01', '2026-09-01']);
  const sync = buildTransactionFilters({}, 't', true);
  assert.equal(sync.where, '');
});

test('valores monetários aceitam padrão brasileiro e internacional simples', () => {
  assert.equal(parseMoney('1234,56'), 1234.56);
  assert.equal(parseMoney('1234.56'), 1234.56);
  assert.ok(Number.isNaN(parseMoney('1.234,56')));
});

test('comparação de sincronização considera exclusão como alteração de negócio', () => {
  const existing = {
    type: 'despesa', cost_center_id: 1, category_id: 2, description: 'Teste',
    counterparty: null, amount: 10, transaction_date: '2026-08-18', notes: null,
    deleted_at: null,
  };
  const incoming = {
    type: 'despesa', centerId: 1, categoryId: 2, description: 'Teste',
    counterparty: null, amount: 10, date: '2026-08-18', notes: null, deleted: false,
  };
  assert.equal(sameBusinessData(existing, incoming), true);
  incoming.deleted = true;
  assert.equal(sameBusinessData(existing, incoming), false);
});
