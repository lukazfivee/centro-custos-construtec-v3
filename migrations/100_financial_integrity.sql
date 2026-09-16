-- Serialize financial mutations with closing. A row lock works in both engines.
CREATE TABLE financial_write_gate (id INTEGER PRIMARY KEY CHECK(id=1), revision BIGINT NOT NULL DEFAULT 0);
INSERT INTO financial_write_gate(id) VALUES(1);
ALTER TABLE transactions ADD COLUMN approval_provenance JSONB;

CREATE FUNCTION lock_financial_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE financial_write_gate SET revision=revision+1 WHERE id=1;
  RETURN NULL;
END $$;
CREATE TRIGGER financial_gate BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION lock_financial_writes();
CREATE TRIGGER allocations_gate BEFORE INSERT OR UPDATE OR DELETE ON transaction_allocations
  FOR EACH STATEMENT EXECUTE FUNCTION lock_financial_writes();
CREATE TRIGGER closings_gate BEFORE INSERT OR UPDATE OR DELETE ON monthly_closings
  FOR EACH STATEMENT EXECUTE FUNCTION lock_financial_writes();

CREATE FUNCTION financial_month_closed(d DATE) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM monthly_closings WHERE year=EXTRACT(YEAR FROM d) AND month=EXTRACT(MONTH FROM d))
$$;

CREATE FUNCTION guard_financial_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metadata text[] := ARRAY['revision','updated_at','updated_by','last_imported_at',
  'last_modified_instance_id','last_modified_instance_name','reversed_at','reversed_by'];
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.public_id<>NEW.public_id OR OLD.id<>NEW.id THEN RAISE EXCEPTION 'FINANCIAL_HISTORY_LOCKED' USING ERRCODE='P4002'; END IF;
    IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
      RAISE EXCEPTION 'FINANCIAL_HISTORY_LOCKED' USING ERRCODE='P4002';
    END IF;
    -- Recording a reversal marker does not change the original period's money.
    IF (to_jsonb(OLD)-metadata)=(to_jsonb(NEW)-metadata) THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP<>'INSERT' THEN
    IF OLD.reversal_of IS NOT NULL OR OLD.reversed_at IS NOT NULL OR OLD.deleted_at IS NOT NULL
      OR EXISTS(SELECT 1 FROM transactions WHERE reversal_of=OLD.public_id) THEN
      RAISE EXCEPTION 'FINANCIAL_HISTORY_LOCKED' USING ERRCODE='P4002';
    END IF;
    IF financial_month_closed(OLD.transaction_date) THEN RAISE EXCEPTION 'FINANCIAL_MONTH_CLOSED' USING ERRCODE='P4001'; END IF;
  END IF;
  IF TG_OP<>'DELETE' AND financial_month_closed(NEW.transaction_date) THEN
    RAISE EXCEPTION 'FINANCIAL_MONTH_CLOSED' USING ERRCODE='P4001';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_transaction_guard BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_financial_transaction();

CREATE FUNCTION guard_financial_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent transactions; parent_id integer;
BEGIN
  FOR parent_id IN SELECT DISTINCT x FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.transaction_id END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.transaction_id END]) x WHERE x IS NOT NULL ORDER BY x LOOP
    SELECT * INTO parent FROM transactions WHERE id=parent_id FOR UPDATE;
    IF FOUND THEN
      IF financial_month_closed(parent.transaction_date) THEN RAISE EXCEPTION 'FINANCIAL_MONTH_CLOSED' USING ERRCODE='P4001'; END IF;
      IF parent.deleted_at IS NOT NULL OR parent.reversed_at IS NOT NULL
        OR EXISTS(SELECT 1 FROM transactions WHERE reversal_of=parent.public_id) THEN
        RAISE EXCEPTION 'FINANCIAL_HISTORY_LOCKED' USING ERRCODE='P4002';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_financial_allocation();

CREATE FUNCTION check_financial_entry(entry_id integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t transactions; original transactions; allocated numeric; parts integer;
  own_split jsonb; original_split jsonb;
BEGIN
  SELECT * INTO t FROM transactions WHERE id=entry_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*),sum(amount) INTO parts,allocated FROM transaction_allocations WHERE transaction_id=t.id;
  IF parts>0 AND allocated<>t.amount THEN RAISE EXCEPTION 'FINANCIAL_ALLOCATION_TOTAL' USING ERRCODE='P4003'; END IF;
  IF t.reversed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transactions WHERE reversal_of=t.public_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FINANCIAL_REVERSAL_INVALID' USING ERRCODE='P4004';
  END IF;
  IF t.reversal_of IS NOT NULL THEN
    SELECT * INTO original FROM transactions WHERE public_id=t.reversal_of;
    IF NOT FOUND OR original.reversal_of IS NOT NULL OR original.deleted_at IS NOT NULL
      OR original.approval_status<>'aprovado' OR original.financial_status<>'liquidado'
      OR t.accounting_sign<>-1 OR t.amount<>original.amount OR t.type<>original.type
      OR t.cost_center_id<>original.cost_center_id OR t.category_id<>original.category_id
      OR t.approval_status<>'aprovado' OR t.financial_status<>'liquidado' OR t.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FINANCIAL_REVERSAL_INVALID' USING ERRCODE='P4004';
    END IF;
    IF parts>0 THEN
      SELECT jsonb_agg(jsonb_build_array(cost_center_id,amount) ORDER BY cost_center_id) INTO own_split
        FROM transaction_allocations WHERE transaction_id=t.id;
      SELECT jsonb_agg(jsonb_build_array(cost_center_id,amount) ORDER BY cost_center_id) INTO original_split
        FROM transaction_allocations WHERE transaction_id=original.id;
      IF own_split IS DISTINCT FROM original_split THEN RAISE EXCEPTION 'FINANCIAL_REVERSAL_INVALID' USING ERRCODE='P4004'; END IF;
    END IF;
  ELSIF t.accounting_sign<>1 THEN
    RAISE EXCEPTION 'FINANCIAL_REVERSAL_INVALID' USING ERRCODE='P4004';
  END IF;
END $$;

CREATE FUNCTION check_financial_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='transactions' THEN
    PERFORM check_financial_entry(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END);
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM check_financial_entry(OLD.transaction_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM check_financial_entry(NEW.transaction_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER financial_consistency AFTER INSERT OR UPDATE OR DELETE ON transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_financial_consistency();
CREATE CONSTRAINT TRIGGER allocation_consistency AFTER INSERT OR UPDATE OR DELETE ON transaction_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_financial_consistency();

CREATE FUNCTION check_closing_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id integer;
BEGIN
  FOR entry_id IN SELECT id FROM transactions WHERE deleted_at IS NULL
    AND EXTRACT(YEAR FROM transaction_date)=NEW.year AND EXTRACT(MONTH FROM transaction_date)=NEW.month LOOP
    PERFORM check_financial_entry(entry_id);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER closing_consistency BEFORE INSERT OR UPDATE ON monthly_closings
  FOR EACH ROW EXECUTE FUNCTION check_closing_consistency();
