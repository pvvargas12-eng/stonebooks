-- =============================================================================
-- 20260604_outgoing_payments.sql
-- PAYMENTS-TAB v2 — money you pay OUT (suppliers, subs, overhead). Not tied to a
-- customer order, so it lives in its own table (incoming customer payments stay
-- on orders.payments[]). Every row is stored atomically with the fields a later
-- QuickBooks sync needs (vendor/payee, category, method, reference, amount,
-- date) so QB becomes a mapping job, not a rebuild.
--
-- APPLY MANUALLY in Supabase Studio (staff never touch the DB through the app).
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists outgoing_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  payee       text not null,
  category    text,
  method      text,
  reference   text,
  amount      numeric not null check (amount > 0),
  paid_date   date not null default current_date,
  direction   text not null default 'out' check (direction = 'out'),
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists outgoing_payments_paid_date_idx on outgoing_payments (paid_date desc);

-- Staff-internal posture: RLS on, single authenticated-only full-CRUD policy
-- (mirrors the scheduler tables). Without this, authenticated writes fail with
-- "new row violates row-level security policy."
alter table outgoing_payments enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'outgoing_payments'
      and policyname = 'outgoing_payments_authenticated_all'
  ) then
    create policy outgoing_payments_authenticated_all on outgoing_payments
      for all to authenticated using (true) with check (true);
  end if;
end $$;
