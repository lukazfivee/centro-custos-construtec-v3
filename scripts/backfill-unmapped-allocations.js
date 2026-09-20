#!/usr/bin/env node
/**
 * Backfill único (correção de dados, não migration):
 * cria expense_allocation 'unmapped' para lançamentos de despesa liquidados
 * em centros de custo com contrato ativo e baseline vigente, que ainda não
 * possuem nenhuma linha em expense_allocations. Idempotente.
 */
require('dotenv').config();
const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { recordExpenseAllocation } = require('../services/budgets/budgetAllocations');

async function main() {
  await initializeDatabase();
  const db = getDb();
  const { rows } = await db.query(
    `SELECT t.id AS transaction_id, t.cost_center_id, t.amount, pc.id AS contract_id
     FROM transactions t
     JOIN project_contracts pc
       ON pc.cost_center_id = t.cost_center_id
      AND pc.status = 'active'
      AND pc.current_baseline_id IS NOT NULL
     WHERE t.type = 'despesa'
       AND t.financial_status = 'liquidado'
       AND t.deleted_at IS NULL
       AND t.reversal_of IS NULL
       AND t.reversed_at IS NULL
       AND COALESCE(t.accounting_sign, 1) = 1
       AND NOT EXISTS (SELECT 1 FROM expense_allocations ea WHERE ea.transaction_id = t.id)
     ORDER BY t.id`
  );
  for (const row of rows) {
    await recordExpenseAllocation(db, {
      transactionId: row.transaction_id,
      costCenterId: row.cost_center_id,
      amount: row.amount,
      contractId: row.contract_id,
    });
  }
  console.log(`Backfill concluído: ${rows.length} expense_allocation(s) 'unmapped' criada(s).`);
  return rows.length;
}

if (require.main === module) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => closeDatabase());
}

module.exports = { main };
