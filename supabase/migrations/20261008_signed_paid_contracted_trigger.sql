-- =============================================================================
-- 20261008_signed_paid_contracted_trigger.sql — signed + money down = contracted,
-- enforced AT THE TABLE
-- =============================================================================
-- Paul 2026-10-08 (Lee E-26-0715): "why is it in draft, it is deposit down and
-- signed, it should not be draft. I must be able to order the stone. FIX THIS
-- NOW and other orders." The 2026-09-18 fix plugged ONE write path (saveOrder)
-- and healed the rows of that day. Signing through the e-sign link (the
-- signing-submit Edge Function writes signed_at) and recording a payment are
-- OTHER paths, so new orders kept landing signed + paid at draft — invisible to
-- the PR needs pool and every work surface. This trigger makes the doctrine
-- hold no matter who writes: any insert/update that leaves an unarchived order
-- signed, with money down, at draft/scoping/quoted → status 'contracted'.
-- "Money down" mirrors rowTotalPaid: non-voided payments[] when any exist,
-- else deposit_amount + balance_amount (legacy rows). Then heals today's rows
-- (logged in the existing _signed_paid_status_heal_log). Idempotent.
-- =============================================================================
create or replace function public.orders_paid_total(o public.orders) returns numeric
language sql stable as $$
  select case
    when jsonb_typeof(coalesce(o.payments, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(o.payments, '[]'::jsonb)) > 0 then
      coalesce((select sum(coalesce((p->>'amount')::numeric, 0)) from jsonb_array_elements(o.payments) p
                where coalesce(p->>'voided', 'false') <> 'true' and coalesce(p->>'voided_at', '') = ''), 0)
    else coalesce(o.deposit_amount, 0) + coalesce(o.balance_amount, 0)
  end
$$;

create or replace function public.orders_auto_contracted() returns trigger
language plpgsql as $$
begin
  if new.archived is not true
     and new.signed_at is not null
     and new.status in ('draft', 'scoping', 'quoted')
     and public.orders_paid_total(new) > 0 then
    new.status := 'contracted';
  end if;
  return new;
end $$;

drop trigger if exists orders_auto_contracted_trg on public.orders;
create trigger orders_auto_contracted_trg
  before insert or update of status, signed_at, payments, deposit_amount, balance_amount, archived
  on public.orders
  for each row execute function public.orders_auto_contracted();

-- ── HEAL today's rows (same log table as 2026-09-18) ────────────────────────
create table if not exists public._signed_paid_status_heal_log (
  order_id uuid primary key,
  order_number text,
  prev_status text,
  healed_at timestamptz default now()
);
insert into public._signed_paid_status_heal_log (order_id, order_number, prev_status)
select id, order_number, status from public.orders o
where o.archived is not true and o.status in ('draft', 'scoping', 'quoted')
  and o.signed_at is not null and public.orders_paid_total(o) > 0
on conflict (order_id) do nothing;

update public.orders o
set status = 'contracted', updated_at = now()
where o.archived is not true and o.status in ('draft', 'scoping', 'quoted')
  and o.signed_at is not null and public.orders_paid_total(o) > 0;

-- VERIFY:
-- select count(*) from orders o where archived is not true and status in ('draft','scoping','quoted') and signed_at is not null and orders_paid_total(o) > 0;  -- 0
-- select tgname from pg_trigger where tgrelid = 'orders'::regclass and tgname = 'orders_auto_contracted_trg';
