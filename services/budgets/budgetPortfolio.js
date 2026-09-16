/**
 * Serviço de Consolidação Executiva da Carteira de Obras (Multi-Obras)
 * Construtec Centro de Custos v3
 */

async function getPortfolioSummary(pool) {
  // 1. Obras cadastradas e situações
  const centersRes = await pool.query(`
    SELECT id, code, name, project_status, active, contract_amount, monthly_budget
    FROM cost_centers
    WHERE active = true
    ORDER BY name ASC
  `);
  const centers = centersRes.rows;
  const statusCounts = { planejamento: 0, execucao: 0, pausado: 0, concluido: 0 };
  centers.forEach(c => {
    if (statusCounts[c.project_status] !== undefined) statusCounts[c.project_status]++;
  });

  // 2. Baselines vigentes e contratos ativos
  const baselinesRes = await pool.query(`
    SELECT pc.cost_center_id, pc.number, bb.contract_value, bb.base_cost,
           COALESCE((SELECT SUM(planned_team_hours) FROM budget_labor_lines WHERE baseline_id = bb.id), 0) AS labor_hours_total
    FROM project_contracts pc
    JOIN budget_baselines bb ON bb.id = pc.current_baseline_id
    WHERE pc.status = 'active'
  `);
  const baselines = baselinesRes.rows;

  let totalContractValue = 0;
  let totalBaseCost = 0;
  let totalPlannedHours = 0;

  baselines.forEach(b => {
    totalContractValue += Number(b.contract_value || 0);
    totalBaseCost += Number(b.base_cost || 0);
    totalPlannedHours += Number(b.labor_hours_total || 0);
  });

  // 3. Realizado líquido consolidado de todas as despesas da carteira
  const realizedRes = await pool.query(`
    SELECT COALESCE(SUM(t.amount * t.accounting_sign), 0) AS total_realized
    FROM transactions t
    WHERE t.deleted_at IS NULL
      AND t.type = 'despesa'
      AND t.financial_status = 'liquidado'
  `);
  const totalRealizedCost = Math.max(0, Number(realizedRes.rows[0]?.total_realized || 0));

  // 4. Horas de mão de obra de equipe medidas em campo
  const laborRes = await pool.query(`
    SELECT COALESCE(SUM(team_hours), 0) AS total_team_hours
    FROM labor_measurements
    WHERE status = 'approved'
  `);
  const totalConsumedHours = Number(laborRes.rows[0]?.total_team_hours || 0);

  // 5. Total de medições contratuais faturadas ao cliente
  const contractMeasRes = await pool.query(`
    SELECT COALESCE(SUM(measured_amount), 0) AS total_billed_amount
    FROM contract_measurements
    WHERE status = 'approved'
  `);
  const totalClientBilled = Number(contractMeasRes.rows[0]?.total_billed_amount || 0);

  // 6. Indicadores consolidados
  const totalBalance = totalBaseCost - totalRealizedCost;
  const burnRatePercent = totalBaseCost > 0
    ? Math.round((totalRealizedCost / totalBaseCost) * 1000) / 10
    : 0;

  // 7. Levantamento de centros individuais com risco orçamentário
  const centersExpensesRes = await pool.query(`
    SELECT cc.id, cc.code, cc.name,
      COALESCE(SUM(t.amount * t.accounting_sign), 0) AS realized
    FROM cost_centers cc
    LEFT JOIN transactions t ON t.cost_center_id = cc.id
      AND t.deleted_at IS NULL AND t.type = 'despesa' AND t.financial_status = 'liquidado'
    WHERE cc.active = true
    GROUP BY cc.id, cc.code, cc.name
  `);

  const baselineByCenter = new Map();
  baselines.forEach(b => baselineByCenter.set(b.cost_center_id, Number(b.base_cost || 0)));

  const atRiskCenters = [];
  centersExpensesRes.rows.forEach(row => {
    const centerRealized = Number(row.realized || 0);
    const centerBase = baselineByCenter.get(row.id) || 0;
    if (centerBase > 0) {
      const centerBurn = Math.round((centerRealized / centerBase) * 1000) / 10;
      if (centerBurn > 80) {
        atRiskCenters.push({
          id: row.id,
          code: row.code,
          name: row.name,
          baseCost: centerBase,
          realizedCost: centerRealized,
          burnRate: centerBurn,
          isOverBudget: centerRealized > centerBase,
        });
      }
    }
  });

  return {
    portfolio: {
      totalCenters: centers.length,
      statusCounts,
      integratedWorksCount: baselines.length,
      totalContractValue,
      totalBaseCost,
      totalRealizedCost,
      totalBalance,
      burnRatePercent,
      isOverBudget: totalRealizedCost > totalBaseCost,
      laborHours: {
        planned: totalPlannedHours,
        consumed: totalConsumedHours,
        balance: totalPlannedHours - totalConsumedHours,
      },
      clientBilling: {
        totalContractValue,
        totalBilled: totalClientBilled,
        balanceToBill: totalContractValue - totalClientBilled,
      },
      atRiskCount: atRiskCenters.length,
      atRiskCenters,
    },
  };
}

module.exports = {
  getPortfolioSummary,
};
