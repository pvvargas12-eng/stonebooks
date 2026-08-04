-- APPT-3 (Paul 2026-08-04): "we need to be able to mark appointment complete
-- or no show". Complete rides the existing 'completed' status; no-show needs a
-- new word. The status CHECK predates the appointment kind — extend it with
-- 'no_show'. (Same disease as the CAL-FIX kind-check lesson, 2026-07-28:
-- when a writer gains a new enum value, the CHECK must learn it first.)
alter table work_batches drop constraint if exists work_batches_status_check;
alter table work_batches add constraint work_batches_status_check
  check (status = any (array[
    'planned', 'in_progress', 'running_late', 'completed', 'cancelled', 'no_show'
  ]::text[]));
