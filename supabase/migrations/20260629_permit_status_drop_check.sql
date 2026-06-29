-- =============================================================================
-- 20260629_permit_status_drop_check.sql
-- Defensive: keep orders.permit_status free-text so the 5 selectable codes AND
-- legacy values can coexist.
-- =============================================================================
-- The new selectable permit statuses are:
--   not_required | cemetery_permit_needed | shev_permit_needed | submitted | approved
-- Legacy rows may carry 'required' (now display-only as "Permit Needed", never
-- selectable) or 'unknown'. The orders table was created via the Supabase
-- dashboard; NO permit_status CHECK constraint exists in any migration file. If a
-- CHECK was added by hand in the dashboard, it would REJECT the two new codes.
--
-- This DO-block finds and drops ANY check constraint that references permit_status
-- (no-op if none exists). It deliberately adds NO new CHECK — a constraint would
-- risk rejecting legacy 'unknown'/'required' rows. Idempotent + safe either way.
-- =============================================================================

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%permit_status%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- ONE-TIME VERIFY (optional). Run this SELECT on its own BEFORE the DO-block above
-- if you want to SEE whether a CHECK constraint existed. Empty result = none (the
-- column was already free-text, and the DO-block above was a harmless no-op):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.orders'::regclass
--     and contype = 'c'
--     and pg_get_constraintdef(oid) ilike '%permit_status%';
-- -----------------------------------------------------------------------------
