const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function validDate(value) {
  if (!ISO_DATE.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validMonth(value) {
  return ISO_MONTH.test(value || '') && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12;
}

function currentMonth(timeZone = process.env.APP_TIMEZONE || 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date());
}

function monthRange(month) {
  if (!validMonth(month)) throw new Error('Mês inválido. Use o formato AAAA-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end: next.toISOString().slice(0, 10) };
}

function monthsEndingAt(month, count = 6) {
  if (!validMonth(month)) throw new Error('Mês inválido.');
  const [year, monthNumber] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - count + index, 1));
    return date.toISOString().slice(0, 7);
  });
}

// "Hoje" (AAAA-MM-DD) no fuso da empresa, para datas padrão: o servidor roda em UTC e,
// depois das 21h de Brasília, toISOString() já daria o dia seguinte.
function todayIso(timeZone = process.env.APP_TIMEZONE || 'America/Sao_Paulo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// "Hoje" no fuso da empresa, dentro do SQL: CURRENT_DATE segue o fuso do servidor (UTC),
// e depois das 21h de Brasília uma conta que vence hoje já apareceria como vencida.
function todaySql(timeZone = process.env.APP_TIMEZONE || 'America/Sao_Paulo') {
  const zone = /^[A-Za-z_]+(\/[A-Za-z_]+)*$/.test(timeZone) ? timeZone : 'America/Sao_Paulo';
  return `(now() AT TIME ZONE '${zone}')::date`;
}

module.exports = { validDate, validMonth, currentMonth, monthRange, monthsEndingAt, todaySql, todayIso };
