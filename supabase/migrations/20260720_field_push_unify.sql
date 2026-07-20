-- =============================================================================
-- 20260720_field_push_unify.sql — reconcile the two 2026-07-18 push builds
-- =============================================================================
-- Two parallel sessions built Web Push on 2026-07-18:
--   • local FIELD-3 applied 20260718_field_owner_suite.sql to prod
--     (notifications + push_state + push_subscriptions with employee_name /
--     p256dh / auth columns + employees.pin) but its code never shipped;
--   • cloud FIELD-PUSH shipped its CODE to prod (expects push_subscriptions
--     with person_name / keys jsonb / user_agent + a push_send_log ledger)
--     but its migration 20260718_field_push.sql was never applied.
-- This migration converges prod on the DEPLOYED code's expectations:
--   1. Reshape push_subscriptions (empty at reconcile time; a defensive copy
--      carries any rows that appeared in the gap) to person_name/keys/user_agent.
--   2. Create push_send_log — the claim-before-send idempotency ledger.
-- Kept as-is from the owner-suite migration: notifications (the in-app bell
-- feed — the unified sender writes it), employees.pin (picker gate), and
-- push_state (unused by the stateless sender; retained, zero cost).
-- Idempotent — safe to re-run.
-- =============================================================================

-- ── 1. push_subscriptions → deployed shape ───────────────────────────────────
do $$
begin
  -- employee_name → person_name
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'push_subscriptions'
               and column_name = 'employee_name') then
    alter table public.push_subscriptions rename column employee_name to person_name;
  end if;

  -- keys jsonb (fold p256dh/auth into it for any row that slipped in)
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'push_subscriptions'
                   and column_name = 'keys') then
    alter table public.push_subscriptions add column keys jsonb;
    update public.push_subscriptions
       set keys = jsonb_build_object('p256dh', p256dh, 'auth', auth)
     where keys is null;
    alter table public.push_subscriptions alter column keys set not null;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'push_subscriptions'
               and column_name = 'p256dh') then
    alter table public.push_subscriptions drop column p256dh;
    alter table public.push_subscriptions drop column auth;
  end if;

  -- device_label → user_agent
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'push_subscriptions'
               and column_name = 'device_label') then
    alter table public.push_subscriptions rename column device_label to user_agent;
  end if;
end $$;

create index if not exists push_subscriptions_person_idx
  on public.push_subscriptions (person_name);

-- ── 2. push_send_log — dedupe ledger (from 20260718_field_push.sql) ──────────
create table if not exists public.push_send_log (
  id            uuid primary key default gen_random_uuid(),
  dedupe_key    text not null unique,
  person_name   text,
  title         text,
  body          text,
  url           text,
  sent_at       timestamptz not null default now()
);
create index if not exists push_send_log_sent_idx on public.push_send_log (sent_at);

alter table public.push_send_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'push_send_log_authenticated_all') then
    create policy push_send_log_authenticated_all on public.push_send_log
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_push_send_log') then
    create policy zz_partner_lockdown_push_send_log on public.push_send_log
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_push_send_log') then
    create policy zz_anon_lockdown_push_send_log on public.push_send_log
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select column_name from information_schema.columns
--   where table_name = 'push_subscriptions' order by ordinal_position;
-- select count(*) from push_send_log;
