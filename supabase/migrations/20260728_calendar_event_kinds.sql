-- =============================================================================
-- 20260728_calendar_event_kinds.sql — CAL-3's event kinds, actually allowed
-- =============================================================================
-- CAL-3 (2026-07-27) shipped the calendar composer writing kinds 'pickup',
-- 'appointment', 'meeting' — but work_batches_kind_check still allowed only
-- the original eleven, so EVERY such add (and every edit-save that remapped a
-- legacy site_visit/errand) failed with a check-constraint violation
-- (Paul 2026-07-28: "MAJOR CALENDAR ERRORS I CANNOT ADD EVENT").
-- Idempotent — safe to re-run.
-- =============================================================================

alter table public.work_batches drop constraint if exists work_batches_kind_check;
alter table public.work_batches add constraint work_batches_kind_check
  check (kind = any (array[
    'inscription','blasting','setting','delivery','acid_wash','repair','rub_grab',
    'foundation_trip','door_trip','site_visit','errand',
    'pickup','appointment','meeting'
  ]::text[]));
