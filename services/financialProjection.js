// Financial eligibility is independent of payment status: approval must precede
// both commitments and cash totals. Deleted entries remain in the audit ledger.
const financialTransactionsSql = `(SELECT * FROM transactions
  WHERE deleted_at IS NULL AND approval_status='aprovado')`;

// One row per appropriation. An allocated entry never also contributes its full
// amount to the original center. Legacy reversals inherit the original split.
const allocatedTransactionsSql = `(
  SELECT t.id,t.public_id,t.type,t.category_id,t.description,t.counterparty,
    COALESCE(a.cost_center_id,t.cost_center_id) AS cost_center_id,
    COALESCE(a.amount,t.amount) AS amount,t.amount AS original_amount,
    t.accounting_sign,t.reversal_of,t.reversal_reason,t.reversed_at,
    t.transaction_date,t.due_date,t.settlement_date,t.financial_status,
    t.document_number,t.payment_method,t.notes,t.created_at,t.deleted_at
  FROM ${financialTransactionsSql} t
  LEFT JOIN transactions original ON original.public_id=t.reversal_of
  LEFT JOIN transaction_allocations a ON a.transaction_id=CASE
    WHEN t.reversal_of IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM transaction_allocations own WHERE own.transaction_id=t.id)
    THEN original.id ELSE t.id END
)`;

module.exports = { financialTransactionsSql, allocatedTransactionsSql };
