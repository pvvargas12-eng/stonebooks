-- =============================================================================
-- 20261008_paper_signed_backfill.sql — the paper-signed batch gets its stamp
-- =============================================================================
-- Paul 2026-10-08: "reconcile those yourself — for this batch only mark the
-- date those were paid as the sign date and override the unsigned to signed.
-- We have them signed analog." Scope = every live order with money down and
-- NO signed_at (34 at dry run; every one already carries contract_signed +
-- deposit_received done on its job — only the order stamp was missing).
-- Sign date = the first non-voided payment's receivedAt (createdAt fallback),
-- then the legacy deposit_received_at, then the order's created date — stamped
-- at NOON New York so neither UTC nor local formatting shifts the day. Mirrors
-- the iPad signing (signed_at + pricing_locked_at), never fakes a signature
-- image. Before-images in _paper_signed_backfill_log; UNDO at the bottom.
-- =============================================================================
create table if not exists public._paper_signed_backfill_log (
  order_id uuid primary key,
  order_number text,
  prev_signed_at timestamptz,
  prev_pricing_locked_at timestamptz,
  new_signed_at timestamptz,
  date_source text,
  applied_at timestamptz default now()
);

with batch as (
  select o.* from public.orders o
  where o.archived is not true and o.signed_at is null and public.orders_paid_total(o) > 0
    and o.status not in ('closed', 'cancelled', 'installed')
), pay as (
  select b.id,
    (select min(coalesce(nullif(p->>'receivedAt', ''), left(p->>'createdAt', 10)))
       from jsonb_array_elements(coalesce(b.payments, '[]'::jsonb)) p
      where coalesce(p->>'voided', 'false') <> 'true' and coalesce((p->>'amount')::numeric, 0) > 0) as first_pay
  from batch b
)
insert into public._paper_signed_backfill_log (order_id, order_number, prev_signed_at, prev_pricing_locked_at, new_signed_at, date_source)
select b.id, b.order_number, b.signed_at, b.pricing_locked_at,
       ((coalesce(pay.first_pay, b.deposit_received_at::text, b.created_at::date::text) || ' 12:00')::timestamp at time zone 'America/New_York'),
       case when pay.first_pay is not null then 'first payment' when b.deposit_received_at is not null then 'legacy deposit column' else 'order created' end
from batch b left join pay on pay.id = b.id
on conflict (order_id) do nothing;

update public.orders o
set signed_at = l.new_signed_at,
    pricing_locked_at = coalesce(o.pricing_locked_at, l.new_signed_at),
    updated_at = now()
from public._paper_signed_backfill_log l
where o.id = l.order_id and o.signed_at is null;

insert into public.order_activity (tenant_id, order_id, type, field, old_value, new_value, note, actor)
select o.tenant_id, l.order_id, 'change', 'Contract', 'unsigned',
       'signed ' || to_char(l.new_signed_at at time zone 'America/New_York', 'YYYY-MM-DD'),
       'Signed on paper — sign date set to the first payment date (batch reconcile 2026-10-08, Paul)',
       'Paul Vargas'
from public._paper_signed_backfill_log l join public.orders o on o.id = l.order_id
where l.applied_at > now() - interval '5 minutes';

-- VERIFY:
-- select count(*) from orders o where archived is not true and signed_at is null and orders_paid_total(o) > 0 and status not in ('closed','cancelled','installed');  -- 0
-- select order_number, new_signed_at::date, date_source from _paper_signed_backfill_log order by order_number;
-- UNDO:
-- update orders o set signed_at = l.prev_signed_at, pricing_locked_at = l.prev_pricing_locked_at from _paper_signed_backfill_log l where o.id = l.order_id;
-- delete from order_activity where note like 'Signed on paper — sign date set to the first payment date (batch reconcile 2026-10-08%';
