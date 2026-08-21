ALTER TABLE cost_centers
  ADD COLUMN client VARCHAR(160),
  ADD COLUMN contract_number VARCHAR(80),
  ADD COLUMN start_date DATE,
  ADD COLUMN end_date DATE,
  ADD COLUMN contract_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (contract_amount >= 0),
  ADD COLUMN project_status VARCHAR(20) NOT NULL DEFAULT 'planejamento'
    CHECK (project_status IN ('planejamento', 'execucao', 'pausado', 'concluido'));

ALTER TABLE cost_centers
  ADD CONSTRAINT cost_centers_date_range CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

ALTER TABLE transactions
  ADD COLUMN due_date DATE,
  ADD COLUMN settlement_date DATE,
  ADD COLUMN financial_status VARCHAR(20) NOT NULL DEFAULT 'liquidado'
    CHECK (financial_status IN ('pendente', 'liquidado')),
  ADD COLUMN document_number VARCHAR(80),
  ADD COLUMN payment_method VARCHAR(40);

UPDATE transactions
SET due_date = transaction_date,
    settlement_date = transaction_date
WHERE due_date IS NULL;

CREATE INDEX transactions_due_date_idx ON transactions (due_date);
CREATE INDEX transactions_financial_status_idx ON transactions (financial_status);
