-- =============================================================================
-- 20260606_recurring_bills_and_outgoing_links.sql
-- PAYMENTS-TAB v2.1 — recurring bill templates + order/bill links on outgoing
-- payments. Extends the outgoing_payments work from 20260604.
--
--   • recurring_bills — templates for overhead that repeats (utilities, payroll,
--     loans, subscriptions). NOT instances: we never materialize unpaid rows;
--     only real payments land in outgoing_payments, so the ledger stays clean
--     for reporting. The monthly view derives "due" from active templates.
--   • outgoing_payments gains recurring_bill_id (which template a payment
--     satisfies) + order_id (an order-tagged cost → feeds THAT order's realized
--     margin; null = overhead, business net only).
--
-- APPLY MANUALLY in Supabase Studio. Idempotent — safe to re-run.
-- =============================================================================

create table if not exists recurring_bills (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  name           text not null,
  category       text,
  frequency      text not null default 'monthly'
                   check (frequency in ('monthly', 'yearly', 'fixed_term')),
  term_count     integer,          -- fixed_term: total number of payments in the term
  amount_default numeric,
  amount_varies  boolean not null default false,
  active         boolean not null default true,
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now()
);

alter table recurring_bills enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'recurring_bills'
      and policyname = 'recurring_bills_authenticated_all'
  ) then
    create policy recurring_bills_authenticated_all on recurring_bills
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Links on outgoing_payments. ON DELETE SET NULL: deleting an order/template
-- never blocks (the payment survives — an order cost just reverts to overhead).
alter table outgoing_payments
  add column if not exists recurring_bill_id uuid references recurring_bills(id) on delete set null;
alter table outgoing_payments
  add column if not exists order_id uuid references orders(id) on delete set null;

create index if not exists outgoing_payments_recurring_bill_idx on outgoing_payments (recurring_bill_id);
create index if not exists outgoing_payments_order_idx on outgoing_payments (order_id);
