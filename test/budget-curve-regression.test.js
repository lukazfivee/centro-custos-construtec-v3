const test = require('node:test');
const assert = require('node:assert/strict');
const { roundDecimal, sumDecimal, multiplyDecimal } = require('../lib/decimal');
const { getCostCenterCurveS } = require('../services/budgets/budgetCurveS');

test('Curva S: HALF_UP, dados insuficientes e cronograma independente do realizado', async () => {
  assert.equal(roundDecimal('10.075'), 10.08);
  assert.equal(roundDecimal('-10.075'), -10.08);
  assert.equal(sumDecimal(['0.1', '0.2']), 0.3);
  assert.equal(multiplyDecimal(['3', '0.335']), 1.01);
  assert.throws(() => roundDecimal('NaN'), /INVALID/);
  assert.throws(() => multiplyDecimal([1], 0), /INVALID/);
  const center = { id: 1, base_cost: '1000.00', contract_value: '1500.00',
    start_date: '2020-01-01', end_date: '2020-02-28' };
  const calculate = async (expenses, measurements) => {
    const rows = [[center], expenses, measurements];
    return getCostCenterCurveS({ query: async () => ({ rows: rows.shift() }) }, 1);
  };
  const expenses = [{ month_key: '2020-01', monthly_amount: '200.00' }];
  const noMeasurement = await calculate(expenses, []);
  assert.equal(noMeasurement.evm.cpi, null);
  assert.equal(noMeasurement.evm.eac, null);
  assert.equal(noMeasurement.evm.ev, null);
  const data = await calculate(expenses, [{ month_key: '2020-01', monthly_measured: '333.33' }]);
  assert.equal(data.evm.ev, 222.22);
  assert.equal(data.evm.cpi, 1.1111);
  assert.equal(data.evm.eac, 900.01);
  assert.equal(data.timeline.length, 2);
  const extended = await calculate([...expenses, { month_key: '2020-04', monthly_amount: '10.00' }], []);
  assert.equal(extended.timeline[1].plannedCumulative, 1000);
  assert.equal(extended.timeline[3].plannedMonth, 0);
  assert.equal(extended.evm.ac, 210);
  const early = await calculate([{ month_key: '2019-12', monthly_amount: '10.00' }], []);
  assert.equal(early.evm.ac, 10);
  assert.equal(early.timeline[0].plannedCumulative, 0);
  const future = await calculate([{ month_key: '2099-01', monthly_amount: '10.00' }], []);
  assert.equal(future.evm.ac, 0);
});
