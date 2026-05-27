-- Cleaning/Repair — service_kind discriminator
-- =============================================================================
-- Adds a nullable `service_kind` to jobs so a single cleaning_repair job_type
-- can be split into acid_wash vs repair. The Scheduler workflow grid needs a
-- separate column for each, but both share the one cleaning_repair milestone
-- template — so the distinction lives on the job row, not the template.
--
-- NULL = legacy / unspecified. Only meaningful when job_type = 'cleaning_repair'.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS
-- + DROP CONSTRAINT IF EXISTS before re-adding the CHECK. Safe to re-run.
-- =============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS service_kind text;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_service_kind_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_service_kind_check CHECK (
    service_kind IS NULL OR service_kind IN ('acid_wash', 'repair')
  );

COMMENT ON COLUMN jobs.service_kind IS
  'Discriminates a cleaning_repair job into acid_wash vs repair for the Scheduler workflow grid (both share the cleaning_repair milestone template). NULL = legacy / unspecified; only meaningful when job_type = ''cleaning_repair''.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'jobs' and column_name = 'service_kind';
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint where conname = 'jobs_service_kind_check';
