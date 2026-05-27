-- Work Batches — AM/PM slot column
-- =============================================================================
-- Adds an explicit half-day slot to work_batches. The scheduler substrate
-- (20260526_scheduler_substrate.sql) gave work_batches a `scheduled_date`
-- (date only) but no time-of-day, so a day could hold multiple batches with
-- no way to order them into a morning vs. afternoon run. This column captures
-- that AM/PM split as first-class data rather than encoding it in the title
-- or notes.
--
-- Nullable on purpose: a batch sitting in the unscheduled build tray
-- (scheduled_date IS NULL) has no slot yet, and even a scheduled batch may be
-- an all-day or unslotted entry. NULL = "no specific half-day slot."
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS
-- + DROP CONSTRAINT IF EXISTS before re-adding the CHECK. Safe to re-run.
-- =============================================================================

ALTER TABLE work_batches
  ADD COLUMN IF NOT EXISTS am_pm text;

-- CHECK allows only 'am' or 'pm'. NULL passes (CHECK fails only on FALSE), so
-- the constraint coexists with the nullable / unslotted state. The explicit
-- IS NULL branch documents that intent.
ALTER TABLE work_batches DROP CONSTRAINT IF EXISTS work_batches_am_pm_check;
ALTER TABLE work_batches
  ADD CONSTRAINT work_batches_am_pm_check CHECK (
    am_pm IS NULL OR am_pm IN ('am', 'pm')
  );

COMMENT ON COLUMN work_batches.am_pm IS
  'Optional half-day slot for a scheduled batch: ''am'' (morning run) or ''pm'' (afternoon run). NULL when unscheduled (in the build tray) or when the batch has no specific half-day slot. Lets a single scheduled_date hold an ordered morning vs. afternoon dispatch.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'work_batches' and column_name = 'am_pm';
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint where conname = 'work_batches_am_pm_check';
