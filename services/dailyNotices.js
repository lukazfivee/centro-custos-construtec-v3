// Avisos diários da Suíte (Fase 4), pedidos pelo cron do Worker às 08:00 de
// Brasília: contas a pagar que vencem hoje ou amanhã e itens de obra acima do
// orçado. O dedupe_key faz cada aviso chegar uma vez só.
const { financialTransactionsSql } = require('./financialProjection');
const { getCostCenterBudgetComparison } = require('./budgets/budgetComparison');

const MAX_OVERRUNS = 20;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Datas do calendário de Brasília (o servidor roda em UTC).
function brasiliaDates(now = new Date()) {
  const day = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return { today: day(now), tomorrow: day(new Date(now.getTime() + 24 * 3600 * 1000)) };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function dueBillsEvent(db, { today, tomorrow }) {
  const { rows } = await db.query(`
    SELECT due_date::text AS dia, COUNT(*)::int AS quantidade, COALESCE(SUM(amount * accounting_sign), 0) AS valor
    FROM ${financialTransactionsSql} t
    WHERE deleted_at IS NULL AND reversal_of IS NULL AND type = 'despesa' AND financial_status = 'pendente'
      AND due_date IN ($1::date, $2::date)
    GROUP BY due_date
  `, [today, tomorrow]);
  const byDay = Object.fromEntries(rows.map((r) => [r.dia, r]));
  const parts = [];
  if (byDay[today]) parts.push(`${plural(byDay[today].quantidade, 'conta vence', 'contas vencem')} hoje (${money.format(Number(byDay[today].valor))})`);
  if (byDay[tomorrow]) parts.push(`${plural(byDay[tomorrow].quantidade, 'vence', 'vencem')} amanhã (${money.format(Number(byDay[tomorrow].valor))})`);
  if (!parts.length) return null;
  return { type: 'conta_vencer', app: 'centro-custos', title: 'Contas a vencer', body: `${parts.join(' e ')}.`, link: 'centro-custos', dedupeKey: `contas:${today}` };
}

async function overrunEvents(db) {
  const { rows: centers } = await db.query(`
    SELECT DISTINCT cc.id, cc.name FROM cost_centers cc
    JOIN project_contracts pc ON pc.cost_center_id = cc.id AND pc.status = 'active'
    WHERE cc.active = TRUE ORDER BY cc.id
  `);
  const events = [];
  for (const center of centers) {
    const comparison = await getCostCenterBudgetComparison(db, center.id);
    for (const item of comparison.items || []) {
      if (!item.isOverBudget || events.length >= MAX_OVERRUNS) continue;
      events.push({
        type: 'acima_orcado', app: 'centro-custos', title: 'Item acima do orçado',
        body: `${center.name}: ${item.name} passou ${money.format(Math.abs(item.balance))} do orçado.`,
        link: `centro-custos?obra=${center.id}`, dedupeKey: `orcado:${center.id}:${item.controlItemId || item.lineId}`,
      });
    }
  }
  return events;
}

async function computeDailyNotices(db, now = new Date()) {
  const bills = await dueBillsEvent(db, brasiliaDates(now));
  return [...(bills ? [bills] : []), ...(await overrunEvents(db))];
}

module.exports = { computeDailyNotices, brasiliaDates };
