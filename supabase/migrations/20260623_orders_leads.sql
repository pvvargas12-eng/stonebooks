-- =============================================================================
-- 20260623_orders_leads.sql — Leads pipeline fields on orders.
-- =============================================================================
-- Leads are NOT a new object — every uncontracted order (status in
-- draft/scoping/quoted) is a lead, derived live. These columns hold the
-- lead-working state. Follow-up touches are order_activity rows (type 'activity',
-- field 'followup') — no new table.
--   next_follow_up — date the next follow-up is due (auto-set +5d on first
--                    estimate generation; manual changes win).
--   waiting_on     — who's holding the ball (status code; see src/lib/leads.js).
--   lost_reason    — why a lead was marked lost (learning data).
--   lost_at        — when it was marked lost (also the "leaves default view" flag).
--
-- Rides the existing orders RLS. APPLY MANUALLY in Supabase Studio. Idempotent.
-- =============================================================================

alter table public.orders
  add column if not exists next_follow_up date,
  add column if not exists waiting_on    text,
  add column if not exists lost_reason   text,
  add column if not exists lost_at       timestamptz;

-- =============================================================================
-- VERIFY:
--   select column_name from information_schema.columns
--     where table_name='orders'
--       and column_name in ('next_follow_up','waiting_on','lost_reason','lost_at');
--   -- expect 4 rows
-- =============================================================================
