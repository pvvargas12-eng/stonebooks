-- =============================================================================
-- 20260629_orders_schedule_status.sql
-- Reference home for the schedule-reconciliation status snapshot.
-- =============================================================================
-- Holds the active-schedule status captured per matched order during the one-time
-- reconciliation: { paidFlag, paidDate, dueNote, cutStatus, stoneStatus, fdnStatus,
-- fdnSize, section, jobType, pause, batchId, reconciledAt, prevStatus, closeReason }.
--
-- REFERENCE ONLY. The permit/payment ledgers are never read or written by this:
-- `paidFlag` is a display echo of the spreadsheet, NOT the money truth. payments[],
-- balance, and payment_status are untouched. Status/due-date/foundation milestones
-- are auto-populated separately (only where the sheet is unambiguous). Idempotent.
-- =============================================================================

alter table public.orders
  add column if not exists schedule_status jsonb not null default '{}'::jsonb;

comment on column public.orders.schedule_status is
  'One-time schedule-reconciliation snapshot (reference): paidFlag/paidDate/dueNote/'
  'cutStatus/stoneStatus/fdnStatus/fdnSize/section/jobType/pause + batchId/'
  'reconciledAt/prevStatus/closeReason. paidFlag is a display echo of the schedule — '
  'NEVER the money ledger (payments[]/balance/payment_status are untouched).';
