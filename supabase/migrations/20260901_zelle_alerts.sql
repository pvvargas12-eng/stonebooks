-- =============================================================================
-- ZELLE-RECONCILE (2026-09-01) — claim ledger for Chase Zelle alert emails
-- =============================================================================
-- Paul: "any zelle payments that go through i want to be able to receive it
-- here, attach to an order as paid, then send receipt... some payments are
-- getting missed from zelle, too many emails." The synced inbox already holds
-- every Chase alert (subject 'You received money with Zelle®'); this table is
-- the claim-before-create ledger (website_leads pattern) so several open desks
-- can sweep without double-minting, plus the match/dismiss/receipt state.
-- =============================================================================

create table if not exists public.zelle_alerts (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null unique references public.messages(id) on delete cascade,
  txn_number       text,
  amount           numeric,
  sender_name      text,
  memo             text,
  sent_date        date,
  received_at      timestamptz,
  status           text not null default 'claimed',  -- claimed|new|matched|dismissed
  order_id         uuid references public.orders(id) on delete set null,
  payment_id       text,
  matched_by       text,
  matched_at       timestamptz,
  receipt_sent_at  timestamptz,
  receipt_sent_to  text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_zelle_alerts_status on public.zelle_alerts(status, received_at desc);
create index if not exists idx_zelle_alerts_txn on public.zelle_alerts(txn_number) where txn_number is not null;

alter table public.zelle_alerts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'zelle_alerts_authenticated_all') then
    create policy zelle_alerts_authenticated_all on public.zelle_alerts
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_zelle_alerts') then
    create policy zz_partner_lockdown_zelle_alerts on public.zelle_alerts
      as restrictive for all to authenticated
      using ((select public.is_staff())) with check ((select public.is_staff()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_zelle_alerts') then
    create policy zz_anon_lockdown_zelle_alerts on public.zelle_alerts
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
