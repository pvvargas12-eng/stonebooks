-- Profit — dimensional substrate + per-job cost estimates (Migration K)
-- =============================================================================
-- Bottom-up P&L foundation. Three things:
--   1. Dimensional tags on jobs / cemetery_orders (sales rep, crew, referral
--      source/entity) + projected/realized margin snapshots. These feed future
--      rollups (rep dashboards, referral ROI) — NOT surfaced as dashboards yet.
--   2. financial_records gains dimensional tags + QBO bridge fields (all
--      nullable, dormant until a later QuickBooks-sync sprint) + cost_phase.
--   3. job_cost_estimates: per-(target, category) estimated costs locked at
--      quote time. Target is XOR a job (family sale) or a cemetery_order.
--      Projected margin = (quoted_total − Σ estimates) / quoted_total.
--
-- Run ONCE in Supabase Studio SQL Editor. Guarded for safe re-run
-- (ADD COLUMN / CREATE ... IF NOT EXISTS; policy dropped-then-created).
-- Requires Postgres 15+ for UNIQUE ... NULLS NOT DISTINCT (Supabase is 15+).
-- =============================================================================

-- ── jobs: dimensional tags + margin snapshots ──────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sales_rep_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS crew_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS referral_source text CHECK (referral_source IS NULL OR referral_source IN ('funeral_home','repeat_family','walk_in','web','cemetery_referral','other'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS referral_entity_id uuid;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quoted_total numeric(10,2);
-- numeric(6,2) not (5,2): a tiny-revenue / big-cost job can realize a margin
-- below -999.99% — (5,2) would overflow and throw at write. (6,2) caps ±9999.99;
-- the app also clamps the computed value. (Data Integrity review, Migration K.)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS projected_margin_pct numeric(6,2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_realized_margin_pct numeric(6,2);

-- ── cemetery_orders: same dimensional tagging (doors generate jobs) ─────────
ALTER TABLE cemetery_orders ADD COLUMN IF NOT EXISTS sales_rep_id uuid;
ALTER TABLE cemetery_orders ADD COLUMN IF NOT EXISTS referral_source text CHECK (referral_source IS NULL OR referral_source IN ('funeral_home','repeat_family','walk_in','web','cemetery_referral','other'));

-- ── financial_records: dimensional tags + QBO bridge (dormant) ──────────────
ALTER TABLE financial_records ADD COLUMN IF NOT EXISTS qbo_account_id text;
ALTER TABLE financial_records ADD COLUMN IF NOT EXISTS qbo_class_id text;
ALTER TABLE financial_records ADD COLUMN IF NOT EXISTS qbo_synced_at timestamptz;
ALTER TABLE financial_records ADD COLUMN IF NOT EXISTS cost_phase text CHECK (cost_phase IS NULL OR cost_phase IN ('estimate','actual','variance'));
ALTER TABLE financial_records ADD COLUMN IF NOT EXISTS dimension_tags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── indexes for future rollup queries ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_sales_rep ON jobs(sales_rep_id) WHERE sales_rep_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_referral_source ON jobs(referral_source) WHERE referral_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_referral_entity ON jobs(referral_entity_id) WHERE referral_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_crew ON jobs(crew_id) WHERE crew_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_records_qbo_unsynced ON financial_records(qbo_synced_at) WHERE qbo_synced_at IS NULL;

-- ── per-job per-category estimates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_cost_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id uuid REFERENCES jobs(id) ON DELETE RESTRICT,
  cemetery_order_id uuid REFERENCES cemetery_orders(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('material','labor','subcontractor','permits_cemetery','install','other')),
  estimated_amount numeric(10,2) NOT NULL CHECK (estimated_amount >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_cost_estimates_target_xor CHECK (
    (job_id IS NOT NULL AND cemetery_order_id IS NULL) OR
    (job_id IS NULL AND cemetery_order_id IS NOT NULL)
  ),
  CONSTRAINT job_cost_estimates_unique_per_target UNIQUE NULLS NOT DISTINCT (job_id, cemetery_order_id, category)
);

CREATE INDEX IF NOT EXISTS idx_job_cost_estimates_job ON job_cost_estimates(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_cost_estimates_cemetery_order ON job_cost_estimates(cemetery_order_id) WHERE cemetery_order_id IS NOT NULL;

ALTER TABLE job_cost_estimates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_cost_estimates_authenticated_all ON job_cost_estimates;
CREATE POLICY job_cost_estimates_authenticated_all ON job_cost_estimates FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE job_cost_estimates IS 'Per-job per-category estimated costs locked at quote time. Used to compute projected margin and to detect variance (actuals from financial_records vs estimates here). One row per (target, category). Target is either a job (family sale) or a cemetery_order (door work).';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify new jobs columns (expect 7 rows):
--   select column_name, data_type from information_schema.columns
--    where table_name='jobs'
--      and column_name in ('sales_rep_id','crew_id','referral_source','referral_entity_id',
--                          'quoted_total','projected_margin_pct','actual_realized_margin_pct')
--    order by column_name;
--
-- Verify cemetery_orders columns (expect 2):
--   select column_name from information_schema.columns
--    where table_name='cemetery_orders' and column_name in ('sales_rep_id','referral_source');
--
-- Verify financial_records columns (expect 5):
--   select column_name, data_type from information_schema.columns
--    where table_name='financial_records'
--      and column_name in ('qbo_account_id','qbo_class_id','qbo_synced_at','cost_phase','dimension_tags');
--
-- Verify job_cost_estimates table + constraints:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='job_cost_estimates'::regclass order by contype;
--   -- expect: PK, two FKs (RESTRICT), category CHECK, estimated_amount>=0 CHECK,
--   --         target_xor CHECK, unique_per_target UNIQUE NULLS NOT DISTINCT
--
-- Verify indexes (expect idx_jobs_* x4, idx_financial_records_qbo_unsynced,
--                 idx_job_cost_estimates_* x2):
--   select indexname from pg_indexes
--    where indexname like 'idx_jobs_%' or indexname like 'idx_job_cost_estimates_%'
--       or indexname = 'idx_financial_records_qbo_unsynced';
--
-- Verify RLS:
--   select relrowsecurity from pg_class where relname='job_cost_estimates';   -- t
--   select polname from pg_policy where polrelid='job_cost_estimates'::regclass;
