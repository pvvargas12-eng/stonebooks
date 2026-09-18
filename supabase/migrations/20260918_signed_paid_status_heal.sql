-- =============================================================================
-- 20260918_signed_paid_status_heal.sql — signed+paid orders can't be leads
-- =============================================================================
-- The Irizarry Arlequin bug (Paul 2026-09-18: "i have orders not showing up
-- for stones needing ordering"): 13 orders carried signed_at + real deposits
-- while status sat at draft/scoping — invisible to the PR needs pool, the
-- Jobs dashboard Active count, hot-list suggestions, and every other surface
-- that applies the drafts-never-on-work-lists doctrine. Paul's standing rule:
-- "active means deposit paid and contract signed." The write-side leak is
-- plugged in saveOrder (auto-advance to contracted at the one chokepoint);
-- this heals the existing rows. Audit log in _signed_paid_status_heal_log.
-- Idempotent.
-- =============================================================================

create table if not exists public._signed_paid_status_heal_log (
  order_id uuid primary key,
  order_number text,
  prev_status text,
  healed_at timestamptz default now()
);

with victims as (
  select o.id, o.order_number, o.status
  from public.orders o
  where o.archived is not true
    and o.status in ('draft', 'scoping', 'quoted')
    and o.signed_at is not null
    and (select coalesce(sum((p->>'amount')::numeric), 0)
         from jsonb_array_elements(coalesce(o.payments, '[]'::jsonb)) p) > 0
)
insert into public._signed_paid_status_heal_log (order_id, order_number, prev_status)
select id, order_number, status from victims
on conflict (order_id) do nothing;

update public.orders o
set status = 'contracted', updated_at = now()
where o.archived is not true
  and o.status in ('draft', 'scoping', 'quoted')
  and o.signed_at is not null
  and (select coalesce(sum((p->>'amount')::numeric), 0)
       from jsonb_array_elements(coalesce(o.payments, '[]'::jsonb)) p) > 0;

-- ── VERIFY ──
-- select count(*) from _signed_paid_status_heal_log;
-- select count(*) from orders where status in ('draft','scoping','quoted') and signed_at is not null
--   and (select coalesce(sum((p->>'amount')::numeric),0) from jsonb_array_elements(coalesce(payments,'[]'::jsonb)) p) > 0 and archived is not true;
