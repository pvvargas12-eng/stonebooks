-- =============================================================================
-- 20261008_deposit_means_contracted.sql — MONEY DOWN = an order, signed or not
-- =============================================================================
-- Paul 2026-10-08 (Fox E-26-0645, Cruikshank E-26-0839 unsearchable in the PR
-- builder): "IF THEY ARE SIGNED AND DEPOSITED THEY ARE ORDERS NOT DRAFTS."
-- Both carry a real deposit ($2,474.50 / $1,213.50) but NO signed_at — paper
-- contracts signed at the counter never get the stamp, so the 2026-10-08
-- trigger (signed + money) left them at draft, invisible to every status-gated
-- work surface. Dry run found 18 such orders ($195–$5,673 down, every one with a
-- job already). The shop's own truth: nobody puts money down without a
-- contract. The trigger now flips on MONEY DOWN alone; signed_at is no longer
-- required. Same log table, idempotent.
-- =============================================================================
create or replace function public.orders_auto_contracted() returns trigger
language plpgsql as $$
begin
  if new.archived is not true
     and new.status in ('draft', 'scoping', 'quoted')
     and public.orders_paid_total(new) > 0 then
    new.status := 'contracted';
  end if;
  return new;
end $$;

-- The trigger itself (orders_auto_contracted_trg, before insert/update of
-- status, signed_at, payments, deposit_amount, balance_amount, archived) is
-- unchanged — only the function body moved.

-- ── HEAL: deposited, unsigned, still at a lead status ────────────────────────
insert into public._signed_paid_status_heal_log (order_id, order_number, prev_status)
select id, order_number, status from public.orders o
where o.archived is not true and o.status in ('draft', 'scoping', 'quoted')
  and public.orders_paid_total(o) > 0
on conflict (order_id) do nothing;

update public.orders o
set status = 'contracted', updated_at = now()
where o.archived is not true and o.status in ('draft', 'scoping', 'quoted')
  and public.orders_paid_total(o) > 0;

-- VERIFY:
-- select count(*) from orders o where archived is not true and status in ('draft','scoping','quoted') and orders_paid_total(o) > 0;  -- 0
-- select count(*) from _signed_paid_status_heal_log where healed_at::date = current_date;  -- 18 + today's earlier 4
