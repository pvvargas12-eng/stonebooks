-- ============================================================================
-- Production floor: hand-picked board (Paul, 2026-07-08)
-- "when i click on ready to bring up i dont want hundreds in there i want only
--  the ones i select (still have a queue log but dont make it automatic)"
-- job_components.on_floor — false = sits in the queue log, true = staff pulled
-- it onto the board. Backfill: anything already advanced past its track's
-- first phase is clearly being worked, so it stays on the board.
-- ============================================================================

alter table job_components add column if not exists on_floor boolean not null default false;

update job_components set on_floor = true
 where on_floor = false
   and current_phase not in ('ready_to_bring_up', 'needs_rubbing', 'pickup_doors', 'bronze_on_order');
