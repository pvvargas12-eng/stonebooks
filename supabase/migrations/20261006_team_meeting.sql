-- =============================================================================
-- 20261006_team_meeting.sql — Sprint TEAM-MEETING-1: A/B weeks + the meeting
-- =============================================================================
-- Paul 2026-10-06 (spec: docs/TEAM_MEETING_SPEC.md, mockup approved through 5
-- rounds): Monday+Friday meetings, alternating A (install) / B (production)
-- weeks. The ONE new truth: the COMMITTED week plan, so Friday can honestly
-- score plan vs done, carry unresolved items forward, and trend the
-- promise-vs-delivery discipline number.
--
--   week_plans       — one row per week (Monday date), kind install|production
--   week_plan_items  — the committed jobs, per lane; outcome scored Friday
--   meeting_notes    — the editable shell per meeting date (verse, closing,
--                      Inputs & needs raised in the room)
-- RLS: the standard staff trio. Idempotent.
-- =============================================================================

create table if not exists public.week_plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  week_start  date not null unique,
  kind        text not null check (kind in ('install', 'production')),
  created_by  text,
  locked_at   timestamptz,
  locked_by   text,
  created_at  timestamptz not null default now()
);

create table if not exists public.week_plan_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  plan_id      uuid not null references public.week_plans(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete cascade,
  lane         text not null check (lane in ('set', 'foundation', 'inscription', 'blast')),
  title        text,
  sort_order   integer not null default 0,
  added_by     text,
  -- Dealer work (no orders link exists for vendor jobs) rides as a titled
  -- item wearing the partner's name as a bright tag (Paul round 4).
  vendor_label  text,
  vendor_item_id uuid,
  outcome      text check (outcome in ('done', 'missed', 'dropped')),
  outcome_note text,
  scored_by    text,
  scored_at    timestamptz,
  created_at   timestamptz not null default now()
);

create unique index if not exists week_plan_items_plan_job_lane_uniq
  on public.week_plan_items (plan_id, lane, job_id) where job_id is not null;
create index if not exists week_plan_items_plan_idx on public.week_plan_items (plan_id);

create table if not exists public.meeting_notes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  meeting_date  date not null unique,
  verse         text,
  verse_ref     text,
  closing_notes text,
  inputs        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.week_plans enable row level security;
alter table public.week_plan_items enable row level security;
alter table public.meeting_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['week_plans', 'week_plan_items', 'meeting_notes'] loop
    if not exists (select 1 from pg_policy where polname = t || '_authenticated_all') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
    end if;
    if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
    end if;
    if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
      execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
    end if;
  end loop;
end $$;

-- ── VERIFY ──
-- select polname from pg_policy where polrelid in ('week_plans'::regclass, 'week_plan_items'::regclass, 'meeting_notes'::regclass);
