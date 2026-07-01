-- =============================================================================
-- 20260701_email_senders.sql  (Email Command Center — Slice 2: sender identity)
-- =============================================================================
-- Per-person sender identity + signature for outgoing shop email. The shop still
-- sends from shevcoteam@gmail.com (one App Password), so "sender" is an identity
-- + signature choice — the chosen person's signature is appended in place of the
-- shared one. Everyone can edit and save their own signature from the app.
--
-- First names only (per spec). Titles/signatures are editable in the app; the
-- seeds below are sensible defaults staff can overwrite.
--
-- RLS: STAFF (is_staff()) read/write. APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: drop table if exists public.email_senders;
-- =============================================================================

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.email_senders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  name           text not null,                 -- first name only (e.g. 'Catherina')
  title          text,                          -- e.g. 'Family Care'
  reply_to       text,                          -- optional Reply-To; SMTP From stays shevcoteam@
  phone          text,
  signature_text text,
  sort_order     int  not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists email_senders_sort_idx on public.email_senders (sort_order, name);

-- Seed the six people (first name only). Skips if any already exist so re-running
-- never duplicates. Signatures are defaults — staff edit them in the app.
insert into public.email_senders (name, title, phone, signature_text, sort_order)
select v.name, v.title, '(732) 442-1286', v.sig, v.ord
from (values
  ('Catherina', 'Family Care',  E'Catherina\nFamily Care · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 1),
  ('Lionel',    'Production',    E'Lionel\nProduction · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 2),
  ('Chelsea',   'Office',        E'Chelsea\nOffice · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 3),
  ('Paul',      'Owner',         E'Paul\nOwner · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 4),
  ('Denise',    'Accounts',      E'Denise\nAccounts · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 5),
  ('Sabina',    'Customer Care', E'Sabina\nCustomer Care · Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n(732) 442-1286 · shevcoteam@gmail.com', 6)
) as v(name, title, sig, ord)
where not exists (select 1 from public.email_senders);

alter table public.email_senders enable row level security;
drop policy if exists email_senders_staff_all on public.email_senders;
create policy email_senders_staff_all on public.email_senders
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- VERIFY: select name, title from email_senders order by sort_order;  -> the six people.
