// ==========================================================================
// SERVIÇO DE ANÁLISE TEMPORAL: CURVA S E PREVISÃO DE TÉRMINO (EAC)
// Metodologia Earned Value Management (EVM / Guia PMBOK Engenharia Civil)
// ==========================================================================

const { roundDecimal: roundMoney, sumDecimal, multiplyDecimal } = require('../../lib/decimal');

function formatYearMonth(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function generateMonthsSeries(startStr, endStr, minMonths = 6) {
  let [sY, sM] = (startStr || formatYearMonth(new Date())).split('-').map(Number);
  let [eY, eM] = (endStr || formatYearMonth(new Date())).split('-').map(Number);

  let totalDiff = (eY - sY) * 12 + (eM - sM) + 1;
  if (totalDiff < minMonths) {
    totalDiff = minMonths;
  }

  const list = [];
  for (let i = 0; i < totalDiff; i++) {
    const totalM = (sM - 1) + i;
    const curY = sY + Math.floor(totalM / 12);
    const curM = (totalM % 12) + 1;
    list.push(`${curY}-${String(curM).padStart(2, '0')}`);
  }
  return list;
}

/**
 * Calcula a Curva S Físico-Financeira e Previsão de Término (EAC)
 */
async function getCostCenterCurveS(pool, costCenterId) {
  // 1. Consultar centro de custo, contrato ativo e baseline
  const ccRes = await pool.query(`
    SELECT cc.id, cc.name, cc.code, cc.contract_amount, cc.start_date, cc.end_date,
           pc.id AS contract_id, pc.number AS contract_number,
           bb.id AS baseline_id, bb.base_cost, bb.contract_value
    FROM cost_centers cc
    LEFT JOIN project_contracts pc ON pc.cost_center_id = cc.id AND pc.status = 'active'
    LEFT JOIN budget_baselines bb ON bb.id = pc.current_baseline_id
    WHERE cc.id = $1
    LIMIT 1
  `, [costCenterId]);

  const center = ccRes.rows[0];
  if (!center) throw new Error('Centro de custo não encontrado');

  const baseCost = Number(center.base_cost || 0);
  const contractValue = Number(center.contract_value || center.contract_amount || 0);

  // 2. Consultar despesas realizadas agrupadas por mês
  const expRes = await pool.query(`
    SELECT TO_CHAR(recognition_date, 'YYYY-MM') AS month_key,
           SUM(amount * sign) AS monthly_amount
    FROM cost_recognitions
    WHERE cost_center_id = $1 AND status = 'approved'
    GROUP BY TO_CHAR(recognition_date, 'YYYY-MM')
    ORDER BY month_key ASC
  `, [costCenterId]);

  const realizedByMonth = new Map();
  let firstRealizedMonth = null;
  let lastRealizedMonth = null;
  for (const row of expRes.rows) {
    const val = Number(row.monthly_amount || 0);
    realizedByMonth.set(row.month_key, val);
    if (!firstRealizedMonth || row.month_key < firstRealizedMonth) firstRealizedMonth = row.month_key;
    if (!lastRealizedMonth || row.month_key > lastRealizedMonth) lastRealizedMonth = row.month_key;
  }

  // 3. Consultar medições de avanço físico/faturamento do contrato
  const measRes = await pool.query(`
    SELECT TO_CHAR(period_end, 'YYYY-MM') AS month_key,
           SUM(measured_amount) AS monthly_measured
    FROM contract_measurements
    WHERE cost_center_id = $1 AND status = 'approved'
    GROUP BY TO_CHAR(period_end, 'YYYY-MM')
    ORDER BY month_key ASC
  `, [costCenterId]);

  const measuredByMonth = new Map();
  for (const row of measRes.rows) {
    measuredByMonth.set(row.month_key, Number(row.monthly_measured || 0));
  }

  // 4. Determinar horizonte de meses da obra
  const currentMonth = formatYearMonth(new Date());
  const startMonth = center.start_date ? formatYearMonth(center.start_date) : (firstRealizedMonth || currentMonth);
  let endMonth = center.end_date ? formatYearMonth(center.end_date) : null;

  if (!endMonth) {
    const [sY, sM] = startMonth.split('-').map(Number);
    const endTotalM = (sM - 1) + 5;
    endMonth = `${sY + Math.floor(endTotalM / 12)}-${String((endTotalM % 12) + 1).padStart(2, '0')}`;
  }
  if (lastRealizedMonth && lastRealizedMonth > endMonth) endMonth = lastRealizedMonth;

  const activityMonths = [...realizedByMonth.keys(), ...measuredByMonth.keys()];
  const scheduleEnd = center.end_date ? formatYearMonth(center.end_date) : endMonth;
  const scheduleMonths = generateMonthsSeries(startMonth, scheduleEnd, center.end_date ? 1 : 6);
  const timelineStart = [startMonth, ...activityMonths].sort()[0];
  endMonth = [scheduleMonths.at(-1), endMonth, ...activityMonths].sort().at(-1);
  const months = generateMonthsSeries(timelineStart, endMonth, 1);
  const totalMonths = months.length;

  // 5. Gerar série prevista da Curva S (função smoothstep cúbica clássica S(t) = 3t^2 - 2t^3)
  const timeline = [];
  let cumPlanned = 0;
  let cumRealized = 0;
  let cumMeasured = 0;

  for (let i = 0; i < totalMonths; i++) {
    const m = months[i];
    const n = scheduleMonths.length;
    const k = m < startMonth ? 0 : m > scheduleMonths.at(-1) ? n : scheduleMonths.indexOf(m) + 1;
    // S(k/n) = (3*k²*n - 2*k³)/n³; só arredonda o resultado monetário.
    const targetCumPlanned = multiplyDecimal([baseCost, 3 * k * k * n - 2 * k * k * k], n ** 3);
    const plannedForMonth = sumDecimal([targetCumPlanned, -cumPlanned]);
    cumPlanned = targetCumPlanned;

    const actualMonth = realizedByMonth.get(m) || 0;
    const measuredMonth = measuredByMonth.get(m) || 0;

    const isPastOrCurrent = m <= currentMonth;

    if (isPastOrCurrent) {
      cumRealized = sumDecimal([cumRealized, actualMonth]);
      cumMeasured = sumDecimal([cumMeasured, measuredMonth]);
    }

    timeline.push({
      month: m,
      monthIndex: i + 1,
      plannedMonth: plannedForMonth,
      plannedCumulative: cumPlanned,
      realizedMonth: isPastOrCurrent ? roundMoney(actualMonth) : null,
      realizedCumulative: isPastOrCurrent ? cumRealized : null,
      measuredMonth: isPastOrCurrent ? roundMoney(measuredMonth) : null,
      measuredCumulative: isPastOrCurrent ? cumMeasured : null,
      isElapsed: isPastOrCurrent,
    });
  }

  // 6. Indicadores de Earned Value Management (EVM) e Previsão de Término
  const totalRealized = cumRealized;
  const totalMeasured = cumMeasured;
  const physicalPercent = contractValue > 0 ? multiplyDecimal([totalMeasured, 100], contractValue) : null;
  const financialBurnPercent = baseCost > 0 ? multiplyDecimal([totalRealized, 100], baseCost) : 0;

  // Earned Value (EV) = Custo orçado do trabalho realizado
  const hasMeasurement = baseCost > 0 && contractValue > 0 && totalMeasured > 0 && totalMeasured <= contractValue;
  const earnedValue = hasMeasurement ? multiplyDecimal([baseCost, totalMeasured], contractValue) : null;

  // CPI = EV / AC (Cost Performance Index)
  const canProject = hasMeasurement && totalRealized > 0;
  const cpi = canProject ? multiplyDecimal([baseCost, totalMeasured],
    [contractValue, totalRealized], 4) : null;

  // EAC = Estimate At Completion (Custo Projetado no Término)
  // Forma algébrica equivalente, sem usar CPI/EV previamente arredondados.
  const eac = canProject ? multiplyDecimal([totalRealized, contractValue], totalMeasured) : null;

  // VAC = Variance At Completion (Desvio Estimado no Término)
  const vac = eac === null ? null : sumDecimal([baseCost, -eac]);
  const isOverBudget = vac === null ? null : vac < 0;

  return {
    costCenterId,
    center: {
      id: center.id,
      name: center.name,
      code: center.code,
      contractNumber: center.contract_number,
      contractValue,
      baseCost,
      startMonth,
      endMonth,
      totalMonths,
    },
    evm: {
      bac: baseCost, // Budget At Completion
      ac: totalRealized, // Actual Cost
      ev: earnedValue, // Earned Value
      cpi, // Cost Performance Index
      physicalPercent, // % Avanço Físico
      financialBurnPercent, // % Consumo Financeiro
      eac, // Estimate At Completion
      vac, // Variance At Completion
      isOverBudget,
      projectedStatus: !canProject ? 'Dados insuficientes para projeção' : isOverBudget ? 'Sobrecusto Projetado' : vac === 0 ? 'No Orçamento' : 'Economia Projetada',
    },
    timeline,
    hypotheses: [
      'Cronograma previsto distribuído pelo modelo cúbico S-Curve de desembolso canônico (fase intermediária com maior concentração de custo).',
      'Avanço e EV estimados pela proporção financeira das medições comerciais aprovadas; não substituem medição física por serviço. Sem medição válida e custo positivo, não há projeção.',
      'Custo Estimado no Término (EAC) projetado pela fórmula clássica do PMBOK: AC + (BAC - EV) / CPI.',
      'Desvio no Término (VAC) indica margem de economia ou estouro esperado na entrega final da obra.'
    ],
  };
}

module.exports = { getCostCenterCurveS };
