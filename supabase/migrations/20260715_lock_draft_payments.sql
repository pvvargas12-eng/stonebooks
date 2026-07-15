-- =============================================================================
-- 20260715_lock_draft_payments.sql — remove the payment owner-review step
-- =============================================================================
-- Paul (2026-07-15): "KOVACS PAID IN FULL AND CONTRACT SIGNED — IT DOESN'T
-- MOVE TO ORDERS. LETS REMOVE OWNER REVIEW FOR NOW."
--
-- Payments created in the Sales wizard started as drafts (locked:false) and
-- only counted after an explicit owner Submit. Audit before this migration
-- found EXACTLY ONE stuck draft in prod: Kovacs E-26-0245, $345 check,
-- received 2026-06-15. The code now creates payments locked:true; this
-- backfill locks the stranded draft(s) so they count.
--
-- Full before-image saved to _payment_draft_lock_backup for reversibility.
-- Idempotent — re-running finds no drafts and changes nothing.
-- =============================================================================

create table if not exists public._payment_draft_lock_backup (
  order_id    uuid,
  payments    jsonb,
  backed_up_at timestamptz default now()
);

insert into public._payment_draft_lock_backup (order_id, payments)
select id, payments from public.orders
where exists (
  select 1 from jsonb_array_elements(payments) p
  where (p->>'locked') = 'false'
    and coalesce((p->>'voided')::boolean, false) = false
);

update public.orders o
set payments = (
  select jsonb_agg(
    case when (p->>'locked') = 'false'
          and coalesce((p->>'voided')::boolean, false) = false
         then p || '{"locked": true}'::jsonb
         else p end
    order by ord
  )
  from jsonb_array_elements(o.payments) with ordinality as t(p, ord)
)
where exists (
  select 1 from jsonb_array_elements(o.payments) p
  where (p->>'locked') = 'false'
    and coalesce((p->>'voided')::boolean, false) = false
);

-- ── VERIFY ──
-- select count(*) from orders o, jsonb_array_elements(o.payments) p
--   where (p->>'locked') = 'false' and coalesce((p->>'voided')::boolean, false) = false;  -- expect 0
-- select order_id, backed_up_at from _payment_draft_lock_backup;
