-- Align orders.permit_denied_at with its siblings (permit_filed_at,
-- permit_approved_at are DATE). It was timestamptz, so the date-only strings
-- the app writes ('2026-07-21') became UTC midnight instants, which render as
-- the previous day in Eastern time. Existing values were all written as
-- date-only strings, so their UTC calendar date IS the intended date.
alter table orders
  alter column permit_denied_at type date
  using (permit_denied_at at time zone 'UTC')::date;
