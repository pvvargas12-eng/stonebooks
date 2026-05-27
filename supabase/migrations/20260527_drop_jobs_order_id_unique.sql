-- Jobs — drop the UNIQUE(order_id) constraint (enable multi-job-per-order)
-- =============================================================================
-- `jobs_order_id_key` (UNIQUE (order_id)) enforced one job per order. Mausoleum
-- door orders break that model: a single order can carry N doors, and each door
-- becomes its own job (one dispatch unit per door) sharing the same order_id
-- and distinguished by jobs.door_index. Dropping the unique constraint lets
-- those N rows coexist.
--
-- The non-unique idx_jobs_order_id index is INTENTIONALLY LEFT IN PLACE — it
-- still serves order_id lookups (e.g. the backfill "which orders have jobs?"
-- query and createJobFromOrder's per-door idempotency check). Dropping the
-- UNIQUE constraint does not drop that separate index.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent via IF EXISTS. Safe to
-- re-run.
-- =============================================================================

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_order_id_key;

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify A — constraint is gone (expect ZERO rows):
--   select conname from pg_constraint
--    where conrelid = 'jobs'::regclass and conname = 'jobs_order_id_key';
-- Verify B — non-unique lookup index survives (expect ONE row):
--   select indexdef from pg_indexes where indexname = 'idx_jobs_order_id';
