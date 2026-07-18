-- =============================================================================
-- 20260718_field_push.sql — FIELD-PUSH substrate: Web Push for the phone app
-- =============================================================================
-- 1. push_subscriptions — one row per phone (browser push endpoint), keyed to
--    the PERSON holding it (fieldIdentity / sb_active_staff name). The field
--    app upserts on enable + every launch (re-keys when the phone switches
--    person); the sender deletes rows whose endpoint returns 404/410.
-- 2. push_send_log — dedupe ledger. The Vercel sender claims a dedupe_key
--    (assigned:{task}:{person} / reply:{reply}:{person} / digest:{person}:{ymd})
--    with an ignore-duplicates upsert BEFORE sending, so overlapping cron runs
--    and the in-app instant pokes can never double-notify. Rows self-prune
--    after ~14 days (sender sweeps).
-- RLS: staff full CRUD, partner + anon locked out (three-role parity). The
-- cron sender uses the service role and bypasses RLS.
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  person_name   text not null,
  endpoint      text not null unique,
  keys          jsonb not null,          -- { p256dh, auth } from PushSubscription.toJSON()
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_person_idx on public.push_subscriptions (person_name);

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

alter table public.push_subscriptions enable row level security;
alter table public.push_send_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'push_subscriptions_authenticated_all') then
    create policy push_subscriptions_authenticated_all on public.push_subscriptions
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_push_subscriptions') then
    create policy zz_partner_lockdown_push_subscriptions on public.push_subscriptions
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_push_subscriptions') then
    create policy zz_anon_lockdown_push_subscriptions on public.push_subscriptions
      as restrictive for all to anon using (false) with check (false);
  end if;
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
-- select count(*) from push_subscriptions; select count(*) from push_send_log;
-- select polname from pg_policy where polrelid in ('push_subscriptions'::regclass, 'push_send_log'::regclass);
