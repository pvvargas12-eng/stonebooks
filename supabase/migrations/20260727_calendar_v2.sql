-- =============================================================================
-- 20260727_calendar_v2.sql — Calendar v2 (CAL-3)
-- =============================================================================
-- Paul's calendar upgrade: typed events with times, multi-day banners,
-- per-event color, multiple attendees, calendar scopes (all / admin_sales /
-- production / personal), simple recurrence, an order link, and the
-- production DAY PRIORITY (inscriptions / foundations / blasting / setting)
-- that opens the matching work list. Events stay work_batches rows — the
-- Scheduler and field Today keep reading the same truth; every new column is
-- nullable/defaulted so existing readers are untouched.
-- Idempotent — safe to re-run.
-- =============================================================================

alter table public.work_batches add column if not exists start_time text;
alter table public.work_batches add column if not exists end_time text;
alter table public.work_batches add column if not exists end_date date;
alter table public.work_batches add column if not exists color text;
alter table public.work_batches add column if not exists attendees jsonb not null default '[]'::jsonb;
alter table public.work_batches add column if not exists calendar_scope text not null default 'all';
alter table public.work_batches add column if not exists owner_name text;
alter table public.work_batches add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.work_batches add column if not exists recur_rule text;
alter table public.work_batches add column if not exists recur_until date;

-- The production day's declared priority — one per date. Focus keys are the
-- work vocabulary: inscriptions / foundations / blasting / setting.
create table if not exists public.production_day_focus (
  focus_date  date primary key,
  focus_key   text not null,
  set_by      text,
  updated_at  timestamptz not null default now()
);

alter table public.production_day_focus enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'production_day_focus_authenticated_all') then
    create policy production_day_focus_authenticated_all on public.production_day_focus
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_production_day_focus') then
    create policy zz_partner_lockdown_production_day_focus on public.production_day_focus
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_production_day_focus') then
    create policy zz_anon_lockdown_production_day_focus on public.production_day_focus
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='work_batches' and column_name in ('start_time','end_time','end_date','color','attendees','calendar_scope','owner_name','order_id','recur_rule','recur_until');
-- select polname from pg_policy where polrelid = 'production_day_focus'::regclass;
