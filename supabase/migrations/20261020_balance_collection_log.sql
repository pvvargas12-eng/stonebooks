-- ── COLLECT-1 (2026-10-20): Payments › Collect balances ──────────────────────
-- Paul: "collecting balances from stones that are on an assembly line or on an
-- installation list, or a bronze that was delivered... press a button that
-- will preview an email requesting a balance... a button that can say call and
-- if you press it that updates last contact... a notes section to annotate the
-- status."
--
-- One append-only log per order: every balance request emailed, every call
-- made, every note typed. "Last contacted for payment" = the newest call/email
-- row; the notes section = the rows themselves, newest first. The queues
-- (install list / line / blasting queue / bronze arrived) are DERIVED from the
-- existing truths at read time — nothing here duplicates them.

create table if not exists public.balance_collection_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  order_id    uuid not null references public.orders(id) on delete cascade,
  kind        text not null check (kind in ('call', 'email', 'text', 'note')),
  note        text,
  amount      numeric(12,2),          -- balance at the time (emails stamp it)
  sent_to     text,                   -- email recipients (emails only)
  actor       text,
  created_at  timestamptz not null default now()
);
create index if not exists balance_collection_log_order_idx on public.balance_collection_log (order_id, created_at desc);

alter table public.balance_collection_log enable row level security;

do $$
declare t text := 'balance_collection_log';
begin
  if not exists (select 1 from pg_policy where polname = t || '_authenticated_all') then
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;
