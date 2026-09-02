-- =============================================================================
-- ACCT-1 (2026-09-01) — Stonebooks Accounting: expense book + document cabinet
-- =============================================================================
-- Paul: "I need Stonebooks accounting... reports JUST LIKE A CPA ready to file
-- taxes... upload receipts and expense reports... bank statements, credit card
-- statements, payroll, insurance, bills." Design approved via mockup
-- (single-member LLC → Schedule C shapes the category vocabulary, which lives
-- in src/lib/acctData.js — category column is deliberately unconstrained text,
-- the NAMES-2/CHECK-constraint lesson: app vocab evolves faster than DDL).
--
-- acct_expenses is the ONE expense book. Rows arrive from the phone receipt
-- snap, desk uploads, and an outgoing_payments mirror sweep (unique
-- outgoing_payment_id = the claim, so several open desks can't double-mint).
-- status inbox → confirmed is Paul's click (reconcile doctrine); writeoff
-- yes/no/pending + writeoff_pct carry the tax call (meals ride 50).
-- =============================================================================

create table if not exists public.acct_expenses (
  id                   uuid primary key default gen_random_uuid(),
  expense_date         date,
  vendor               text,
  note                 text,
  amount               numeric,
  category             text,
  writeoff             text not null default 'pending',   -- yes | no | pending
  writeoff_pct         int not null default 100,
  status               text not null default 'inbox',     -- inbox | confirmed
  source               text not null default 'upload',    -- phone | upload | statement | outgoing
  receipt_path         text,
  outgoing_payment_id  uuid unique references public.outgoing_payments(id) on delete set null,
  ai                   jsonb,
  created_by           text,
  confirmed_by         text,
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists idx_acct_expenses_status on public.acct_expenses(status, expense_date desc);
create index if not exists idx_acct_expenses_date on public.acct_expenses(expense_date desc);

create table if not exists public.acct_documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'other',   -- bank_statement | cc_statement | payroll | insurance | bill | other
  label         text,
  month         text,                            -- 'YYYY-MM'
  storage_path  text not null,
  filename      text,
  uploaded_by   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_acct_documents_kind on public.acct_documents(kind, month desc);

alter table public.acct_expenses enable row level security;
alter table public.acct_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'acct_expenses_authenticated_all') then
    create policy acct_expenses_authenticated_all on public.acct_expenses
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_acct_expenses') then
    create policy zz_partner_lockdown_acct_expenses on public.acct_expenses
      as restrictive for all to authenticated
      using ((select public.is_staff())) with check ((select public.is_staff()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_acct_expenses') then
    create policy zz_anon_lockdown_acct_expenses on public.acct_expenses
      as restrictive for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policy where polname = 'acct_documents_authenticated_all') then
    create policy acct_documents_authenticated_all on public.acct_documents
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_acct_documents') then
    create policy zz_partner_lockdown_acct_documents on public.acct_documents
      as restrictive for all to authenticated
      using ((select public.is_staff())) with check ((select public.is_staff()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_acct_documents') then
    create policy zz_anon_lockdown_acct_documents on public.acct_documents
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
