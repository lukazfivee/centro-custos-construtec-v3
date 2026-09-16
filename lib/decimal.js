// Mesmo algoritmo racional de Orçamentos/src/shared/decimal.ts, sem dependência entre apps.
function fraction(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('FINANCIAL_VALUE_INVALID');
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (Math.abs(scale) > 100) throw new Error('FINANCIAL_VALUE_INVALID');
  const numerator = BigInt(match[2] + (match[3] ?? '')) * (match[1] ? -1n : 1n);
  return scale >= 0 ? { numerator, denominator: 10n ** BigInt(scale) }
    : { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n };
}

function rounded({ numerator, denominator }, decimals) {
  if (denominator === 0n) throw new Error('FINANCIAL_VALUE_INVALID');
  const factor = 10n ** BigInt(decimals);
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absolute = (numerator < 0n ? -numerator : numerator) * factor;
  const divisor = denominator < 0n ? -denominator : denominator;
  const units = absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n);
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('FINANCIAL_TOTAL_TOO_LARGE');
  return Number(negative ? -units : units) / Number(factor);
}

const roundDecimal = (value, decimals = 2) => rounded(fraction(value), decimals);
const sumDecimal = (values, decimals = 2) => rounded(values.reduce((sum, value) => {
  const next = fraction(value);
  const denominator = sum.denominator > next.denominator ? sum.denominator : next.denominator;
  return { numerator: sum.numerator * (denominator / sum.denominator)
    + next.numerator * (denominator / next.denominator), denominator };
}, { numerator: 0n, denominator: 1n }), decimals);

function multiplyDecimal(values, divisor = 1, decimals = 2) {
  const product = values.map(fraction).reduce((total, value) => ({
    numerator: total.numerator * value.numerator, denominator: total.denominator * value.denominator,
  }), { numerator: 1n, denominator: 1n });
  const by = (Array.isArray(divisor) ? divisor : [divisor]).map(fraction).reduce((total, value) => ({
    numerator: total.numerator * value.numerator, denominator: total.denominator * value.denominator,
  }), { numerator: 1n, denominator: 1n });
  return rounded({ numerator: product.numerator * by.denominator,
    denominator: product.denominator * by.numerator }, decimals);
}

module.exports = { roundDecimal, sumDecimal, multiplyDecimal };
