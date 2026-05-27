-- Jobs — door_index (multi-job mausoleum_door orders)
-- =============================================================================
-- A mausoleum_door order can carry several doors, and each door becomes its own
-- job (one trip / dispatch unit per door). `door_index` records which door a
-- given job serves: a zero-based index into the parent order's
-- `mausoleum_door_intake.doors[]` array.
--
-- NULL for any non-mausoleum_door job (the normal one-job-per-order case).
-- No CHECK constraint — the valid range is just 0..N-1 against the order's
-- doors array, which the app enforces; the column is a plain nullable int.
-- (order_id, door_index) together identify a door-job for idempotent re-creation.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS door_index int;

COMMENT ON COLUMN jobs.door_index IS
  'Zero-based index into the parent order''s mausoleum_door_intake.doors[] array; identifies which door this job serves. NULL for any non-mausoleum_door job. (order_id, door_index) keys a door-job for idempotent re-creation.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'jobs' and column_name = 'door_index';
--   -- expect: door_index | integer | YES
