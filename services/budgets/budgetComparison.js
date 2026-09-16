function roundMoney(val) {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula o comparativo Orçado vs. Realizado consolidado para um centro de custo
 */
async function getCostCenterBudgetComparison(pool, costCenterId, options = {}) {
  const { contractId = null, baselineId = null, cutOffDate = null } = options;

  // 1. Obter contrato e baseline vigente (ou especificada)
  let contractQuery = `
    SELECT pc.id AS contract_id, pc.number AS contract_number, pc.current_baseline_id,
           bb.id AS baseline_id, bb.version AS baseline_version,
           bb.materials_cost, bb.labor_cost, bb.base_cost, bb.contract_value
    FROM project_contracts pc
    LEFT JOIN budget_baselines bb ON bb.id = COALESCE($2, pc.current_baseline_id)
    WHERE pc.cost_center_id = $1 AND pc.status = 'active'
  `;
  const contractParams = [costCenterId, baselineId];
  if (contractId) {
    contractQuery += ' AND pc.id = $3';
    contractParams.push(contractId);
  }
  contractQuery += ' LIMIT 1';

  const contractRes = await pool.query(contractQuery, contractParams);
  const contract = contractRes.rows[0];

  if (!contract || !contract.baseline_id) {
    return {
      hasBudget: false,
      costCenterId,
      message: 'Nenhum orçamento/baseline vigente encontrado para este centro de custo.',
      summary: { contractValue: 0, baseCost: 0, realizedCost: 0, exposure: 0, balance: 0 },
      items: [],
      unmapped: { totalCost: 0, items: [] },
      abcCurve: { a: [], b: [], c: [] },
      laborHours: { planned: 0, consumed: 0, balance: 0 },
    };
  }

  // 2. Obter linhas orçadas de materiais
  const matRes = await pool.query(`
    SELECT bml.id AS line_id, bml.control_item_id, bml.code, bml.description, bml.category,
           bml.unit, bml.quantity, bml.unit_cost, bml.total_cost, 'material' AS kind,
           bci.name AS item_name
    FROM budget_material_lines bml
    JOIN budget_control_items bci ON bci.id = bml.control_item_id
    WHERE bml.baseline_id = $1
    ORDER BY bml.position ASC
  `, [contract.baseline_id]);

  // 3. Obter linhas orçadas de mão de obra
  const labRes = await pool.query(`
    SELECT bll.id AS line_id, bll.control_item_id, bll.role_name AS description,
           'Mão de Obra' AS category, 'h' AS unit, bll.planned_team_hours AS quantity,
           bll.hourly_rate AS unit_cost, bll.total_cost, 'labor' AS kind,
           bll.planned_team_hours, bci.name AS item_name
    FROM budget_labor_lines bll
    JOIN budget_control_items bci ON bci.id = bll.control_item_id
    WHERE bll.baseline_id = $1
    ORDER BY bll.position ASC
  `, [contract.baseline_id]);

  // 4. Obter reconhecimentos de custos aprovados por item de controle
  let costRecQuery = `
    SELECT control_item_id,
           SUM(amount * sign) AS realized_amount
    FROM cost_recognitions
    WHERE cost_center_id = $1 AND status = 'approved'
  `;
  const costRecParams = [costCenterId];
  if (cutOffDate) {
    costRecQuery += ' AND recognition_date <= $2';
    costRecParams.push(cutOffDate);
  }
  costRecQuery += ' GROUP BY control_item_id';

  const costRecRes = await pool.query(costRecQuery, costRecParams);
  const realizedMap = new Map();
  for (const row of costRecRes.rows) {
    realizedMap.set(row.control_item_id, Number(row.realized_amount));
  }

  // 5. Obter apropriações não mapeadas
  const unmappedRes = await pool.query(`
    SELECT ea.id, ea.amount, ea.notes, t.transaction_date AS date, t.description, t.payment_method
    FROM expense_allocations ea
    JOIN transactions t ON t.id = ea.transaction_id
    WHERE ea.cost_center_id = $1 AND ea.mapping_status = 'unmapped'
  `, [costCenterId]);

  let unmappedTotal = 0;
  const unmappedList = unmappedRes.rows.map(r => {
    const val = Number(r.amount);
    unmappedTotal += val;
    return {
      id: r.id,
      amount: roundMoney(val),
      notes: r.notes,
      date: r.date,
      description: r.description,
    };
  });

  // 6. Horas de equipe consumidas (medições aprovadas)
  const hoursRes = await pool.query(`
    SELECT COALESCE(SUM(team_hours), 0) AS total_hours
    FROM labor_measurements
    WHERE contract_id = $1 AND status = 'approved'
  `, [contract.contract_id]);
  const consumedHours = Number(hoursRes.rows[0]?.total_hours || 0);

  let plannedTotalHours = 0;
  for (const l of labRes.rows) {
    plannedTotalHours += Number(l.planned_team_hours || 0);
  }

  // 7. Consolidar linhas orçado vs realizado por item de controle
  const combinedLines = [...matRes.rows, ...labRes.rows];
  let totalBudgeted = 0;
  let totalRealized = 0;

  const items = combinedLines.map(line => {
    const budgeted = roundMoney(line.total_cost);
    const realized = roundMoney(realizedMap.get(line.control_item_id) || 0);
    const variance = roundMoney(realized - budgeted);
    const variancePercent = budgeted > 0 ? roundMoney(((realized - budgeted) / budgeted) * 100) : null;
    const balance = roundMoney(budgeted - realized);

    totalBudgeted += budgeted;
    totalRealized += realized;

    return {
      lineId: line.line_id,
      controlItemId: line.control_item_id,
      code: line.code || null,
      name: line.item_name || line.description,
      description: line.description,
      category: line.category,
      kind: line.kind,
      unit: line.unit,
      budgetedQuantity: Number(line.quantity),
      budgetedUnitCost: Number(line.unit_cost),
      budgetedCost: budgeted,
      realizedCost: realized,
      variance,
      variancePercent,
      balance,
      isOverBudget: balance < 0,
    };
  });

  // 8. Total realizado global inclui despesas não mapeadas
  const grandRealized = roundMoney(totalRealized + unmappedTotal);
  const grandExposure = grandRealized; // Futuramente soma ordens de compra em aberto
  const grandBalance = roundMoney(Number(contract.base_cost) - grandExposure);

  // 9. Construir Curva ABC dos itens com custo realizado positivo
  const positiveItems = items.filter(i => i.realizedCost > 0).sort((a, b) => b.realizedCost - a.realizedCost);
  const positiveTotal = positiveItems.reduce((acc, i) => acc + i.realizedCost, 0);

  const abcCurve = { a: [], b: [], c: [] };
  let accumulated = 0;

  for (const item of positiveItems) {
    const shareBefore = positiveTotal > 0 ? (accumulated / positiveTotal) * 100 : 0;
    if (shareBefore < 80) {
      abcCurve.a.push(item);
    } else if (shareBefore < 95) {
      abcCurve.b.push(item);
    } else {
      abcCurve.c.push(item);
    }
    accumulated += item.realizedCost;
  }

  return {
    hasBudget: true,
    costCenterId,
    contract: {
      id: contract.contract_id,
      number: contract.contract_number,
      baselineId: contract.baseline_id,
      baselineVersion: contract.baseline_version,
      contractValue: roundMoney(contract.contract_value),
      baseCost: roundMoney(contract.base_cost),
      materialsCost: roundMoney(contract.materials_cost),
      laborCost: roundMoney(contract.labor_cost),
    },
    summary: {
      contractValue: roundMoney(contract.contract_value),
      baseCost: roundMoney(contract.base_cost),
      budgetedDirectCost: roundMoney(totalBudgeted),
      realizedCost: grandRealized,
      realizedMappedCost: roundMoney(totalRealized),
      realizedUnmappedCost: roundMoney(unmappedTotal),
      exposure: grandExposure,
      balance: grandBalance,
      isOverBudget: grandBalance < 0,
      burnRatePercent: Number(contract.base_cost) > 0 ? roundMoney((grandExposure / Number(contract.base_cost)) * 100) : 0,
    },
    laborHours: {
      planned: roundMoney(plannedTotalHours),
      consumed: roundMoney(consumedHours),
      balance: roundMoney(plannedTotalHours - consumedHours),
    },
    items,
    unmapped: {
      totalCost: roundMoney(unmappedTotal),
      count: unmappedList.length,
      items: unmappedList,
    },
    abcCurve: {
      aCount: abcCurve.a.length,
      bCount: abcCurve.b.length,
      cCount: abcCurve.c.length,
      a: abcCurve.a,
      b: abcCurve.b,
      c: abcCurve.c,
    },
  };
}

module.exports = {
  getCostCenterBudgetComparison,
  roundMoney,
};
