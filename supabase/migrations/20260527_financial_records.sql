-- Financial Records — unified operational ledger (Migration J)
-- =============================================================================
-- Every dollar in or out of the business, in one table. Powers per-job
-- profitability (revenue − expenses grouped by job_id) and company-level P&L.
-- Polymorphic linkage: a record may attach to a job, a family order, or a
-- cemetery order; orderless overhead (rent, utilities) leaves all three NULL.
--
-- This complements QuickBooks (accounting compliance) — it is NOT a
-- replacement. Its purpose is operational intelligence the shop can act on.
--
-- Run ONCE in Supabase Studio SQL Editor. Guarded for safe re-run
-- (IF NOT EXISTS on table/indexes; policy dropped-then-created).
-- =============================================================================

CREATE TABLE IF NOT EXISTS financial_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  record_type text NOT NULL CHECK (record_type IN ('payment_received', 'expense_incurred')),
  amount numeric(10,2) NOT NULL CHECK (amount <> 0),   -- zero is always a data-entry error; signed refunds allowed
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- Polymorphic linkage (job-attributable records set one; overhead sets none).
  -- ON DELETE RESTRICT: a parent with ledger rows can't be deleted until those
  -- rows are reassigned/voided — preserves P&L attribution integrity.
  job_id uuid REFERENCES jobs(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  cemetery_order_id uuid REFERENCES cemetery_orders(id) ON DELETE RESTRICT,

  -- Payment fields
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('check','credit_card','cash','zelle','bank_transfer','other')),
  payment_reference text,

  -- Expense fields
  category text CHECK (category IS NULL OR category IN ('material','labor','subcontractor','cemetery_fee','equipment','vehicle','overhead','other')),
  vendor text,
  description text,
  receipt_storage_path text,

  -- Labor (milestone-based — Phase 1 stub, not surfaced in UI tonight)
  milestone_key text,
  labor_hours numeric(6,2),
  labor_rate numeric(8,2),

  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_records_job ON financial_records(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_records_order ON financial_records(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_records_cemetery_order ON financial_records(cemetery_order_id) WHERE cemetery_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_records_type_date ON financial_records(tenant_id, record_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_records_category ON financial_records(tenant_id, category) WHERE category IS NOT NULL;

ALTER TABLE financial_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_records_authenticated_all ON financial_records;
CREATE POLICY financial_records_authenticated_all ON financial_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE financial_records IS
  'Unified financial ledger — every dollar in or out of the business. Operational truth for per-job profitability (revenue - expenses by job_id) and company-level P&L. NOT a replacement for QuickBooks accounting compliance; complements it with operational intelligence.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify table + columns (expect 21 rows):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'financial_records'
--    order by ordinal_position;
--
-- Verify CHECK constraints (expect record_type, payment_method, category):
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'financial_records'::regclass and contype = 'c';
--
-- Verify indexes (expect 5 idx_financial_records_* + the pkey):
--   select indexname from pg_indexes where tablename = 'financial_records';
--
-- Verify RLS enabled + policy:
--   select relrowsecurity from pg_class where relname = 'financial_records';   -- expect t
--   select polname from pg_policy where polrelid = 'financial_records'::regclass;
