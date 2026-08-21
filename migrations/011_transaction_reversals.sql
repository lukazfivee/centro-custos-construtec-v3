ALTER TABLE transactions
  ADD COLUMN accounting_sign SMALLINT NOT NULL DEFAULT 1 CHECK (accounting_sign IN (-1, 1)),
  ADD COLUMN reversal_of UUID REFERENCES transactions(public_id),
  ADD COLUMN reversal_reason VARCHAR(500),
  ADD COLUMN reversed_at TIMESTAMPTZ,
  ADD COLUMN reversed_by INTEGER REFERENCES users(id);

CREATE UNIQUE INDEX transactions_single_reversal_idx
  ON transactions (reversal_of)
  WHERE reversal_of IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX transactions_reversal_of_idx
  ON transactions (reversal_of)
  WHERE reversal_of IS NOT NULL;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_reversal_sign_check
  CHECK (reversal_of IS NULL OR accounting_sign = -1);
