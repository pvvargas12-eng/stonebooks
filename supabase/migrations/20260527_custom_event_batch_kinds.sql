-- Custom Event Batch Kinds
-- =============================================================================
-- Extends the work_batches kind CHECK constraint to include two new ad-hoc
-- event kinds — site_visit and errand — so zero-job batches can serve as
-- custom calendar entries.
--
-- Run ONCE in Supabase Studio SQL Editor after the scheduler-substrate
-- migration. Idempotent: drops + recreates the constraint, safe to re-run.
-- =============================================================================

ALTER TABLE work_batches DROP CONSTRAINT IF EXISTS work_batches_kind_check;
ALTER TABLE work_batches
  ADD CONSTRAINT work_batches_kind_check CHECK (
    kind IN (
      'inscription', 'blasting', 'setting', 'delivery',
      'acid_wash', 'repair', 'rub_grab',
      'foundation_trip', 'door_trip',
      'site_visit', 'errand'
    )
  );

COMMENT ON CONSTRAINT work_batches_kind_check ON work_batches IS
  'Eleven kinds: nine workflow kinds (inscription, blasting, setting, delivery, acid_wash, repair, rub_grab, foundation_trip, door_trip) plus two ad-hoc event kinds (site_visit, errand) used for zero-job calendar entries.';
