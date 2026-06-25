-- =============================================================================
-- 20260625_proof_versions_order_scope.sql
-- =============================================================================
-- Option A — a proof_versions row may belong to EITHER a job OR an order (lead),
-- so a pre-contract "estimate layout" is a REAL proof that carries onto the job
-- at sign-time. Makes job_id NULLABLE, adds order_id, enforces exactly-one-owner
-- (job XOR order), and rebuilds the one-current + version-number invariants
-- PER OWNER.
--
-- Existing rows are all job-scoped (order_id NULL) → they satisfy the new CHECK
-- and the per-job partial indexes unchanged. No data backfill needed.
--
-- RUN ORDER: this FIRST, then 20260625_create_proof_version_owner.sql (the RPC
-- inserts order_id, so it depends on this column existing).
-- =============================================================================

-- ── 1. job_id nullable + add the order owner ────────────────────────────────
ALTER TABLE proof_versions ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE proof_versions
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE CASCADE;

-- ── 2. Exactly one owner (job XOR order) ────────────────────────────────────
ALTER TABLE proof_versions DROP CONSTRAINT IF EXISTS proof_versions_one_owner;
ALTER TABLE proof_versions
  ADD CONSTRAINT proof_versions_one_owner
  CHECK ((job_id IS NOT NULL) <> (order_id IS NOT NULL));

-- ── 3. One-current-per-OWNER (replaces the per-job-only partial unique) ─────
DROP INDEX IF EXISTS idx_proof_versions_one_current_per_job;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_one_current_per_job
  ON proof_versions (job_id)   WHERE is_current = true AND job_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_one_current_per_order
  ON proof_versions (order_id) WHERE is_current = true AND order_id IS NOT NULL;

-- ── 4. Per-OWNER version-number uniqueness ──────────────────────────────────
-- The inline UNIQUE(job_id,version_number) won't hold for order rows (job_id
-- NULL), so replace it with two partial unique indexes. Drop the inline
-- constraint by its REAL name (NOT guessed): Postgres auto-names it
-- proof_versions_job_id_version_number_key, but this DO block drops whatever
-- UNIQUE constraint actually covers exactly (job_id, version_number).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.proof_versions'::regclass
       AND con.contype = 'u'
       AND (
         SELECT array_agg(a.attname ORDER BY a.attname)
           FROM unnest(con.conkey) AS k
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
       ) = ARRAY['job_id','version_number']
  LOOP
    EXECUTE format('ALTER TABLE public.proof_versions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_jobver
  ON proof_versions (job_id, version_number)   WHERE job_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pv_orderver
  ON proof_versions (order_id, version_number) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv_order_version
  ON proof_versions (order_id, version_number DESC);

-- RLS is unchanged: proof_versions_authenticated_all is USING(true)/WITH
-- CHECK(true), so order-scoped rows are already covered. Storage policies are
-- bucket-scoped (orders-attachments-public) and need no change.

-- ── 5. Verify (paste in chat after running) ─────────────────────────────────
-- SELECT
--   EXISTS(SELECT 1 FROM information_schema.columns
--          WHERE table_name='proof_versions' AND column_name='order_id')        AS order_id_col,
--   EXISTS(SELECT 1 FROM pg_constraint WHERE conname='proof_versions_one_owner') AS xor_check,
--   EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_pv_one_current_per_job')   AS job_current_idx,
--   EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_pv_one_current_per_order') AS order_current_idx,
--   EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_pv_jobver')   AS jobver_idx,
--   EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_pv_orderver') AS orderver_idx,
--   (SELECT count(*) FROM proof_versions WHERE job_id IS NULL AND order_id IS NULL) AS orphans;
-- Expected: all booleans = t · orphans = 0
