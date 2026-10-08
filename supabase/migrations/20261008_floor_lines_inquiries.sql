-- =============================================================================
-- 20261008_floor_lines_inquiries.sql — Sprint LINES-1 + INQUIRIES-1
-- =============================================================================
-- Paul 2026-10-08 ("OK BIG BUILD"): (1) the production floor runs in ASSEMBLY
-- LINES of ~18 stones, built ahead in a Line Planner, completing when every
-- stone is blasted; (2) website form submissions get their own Inquiries tab
-- instead of flooding the Sales reminders list — a lead is created when the
-- inquiry is actioned (Done), never on arrival.
--
--   floor_lines        — one row per line (number, soft capacity, week,
--                        started_at = running, completed_at = all blasted)
--   floor_line_items   — the stones (job_components dies) on a line, in order;
--                        a stone sits on exactly ONE line (component_id unique)
--   website_leads      — + inquiry_status / interest / first-touch / actioned
--
-- DATA: everything on the floor today becomes LINE 1 (Paul: "everything
-- currently in production floor create on a line call it Line 1"), ordered
-- furthest-along first. The 57 open website-minted Sales tasks are soft-
-- deleted (deleted_at, deleted_by 'INQUIRIES-1') and logged so they can be
-- restored; the Inquiries tab carries that work now.
-- RLS: the standard staff trio. Idempotent.
-- =============================================================================

create table if not exists public.floor_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  number        integer not null unique,
  label         text,
  track         text not null default 'new_stone',
  week_start    date,
  capacity      integer not null default 18,
  started_at    timestamptz,
  completed_at  timestamptz,
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.floor_line_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  line_id       uuid not null references public.floor_lines(id) on delete cascade,
  component_id  uuid not null unique references public.job_components(id) on delete cascade,
  job_id        uuid,
  order_id      uuid,
  position      integer not null default 0,
  added_by      text,
  added_at      timestamptz not null default now()
);
create index if not exists floor_line_items_line_idx on public.floor_line_items (line_id, position);

alter table public.floor_lines enable row level security;
alter table public.floor_line_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['floor_lines', 'floor_line_items'] loop
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

-- ── Inquiries: the website_leads row IS the inquiry now ─────────────────────
alter table public.website_leads add column if not exists inquiry_status text not null default 'new';
alter table public.website_leads add column if not exists interest text;
alter table public.website_leads add column if not exists first_touch_at timestamptz;
alter table public.website_leads add column if not exists first_touch_by text;
alter table public.website_leads add column if not exists actioned_at timestamptz;
alter table public.website_leads add column if not exists actioned_by text;
alter table public.website_leads add column if not exists inquiry_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'website_leads_inquiry_status_check') then
    alter table public.website_leads add constraint website_leads_inquiry_status_check
      check (inquiry_status in ('new', 'emailed', 'done', 'junk'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'website_leads_interest_check') then
    alter table public.website_leads add constraint website_leads_interest_check
      check (interest is null or interest in ('new_stone', 'bronze', 'inscription', 'unsure'));
  end if;
end $$;
create index if not exists website_leads_inquiry_status_idx on public.website_leads (inquiry_status, created_at desc);

-- ── DATA 1: Line 1 = everything on the floor today ──────────────────────────
do $$
declare
  n_items integer;
  line_id uuid;
begin
  if not exists (select 1 from public.floor_lines) then
    insert into public.floor_lines (number, label, track, capacity, started_at, created_by)
    values (1, 'Line 1', 'new_stone', 18, now(), 'LINES-1 migration')
    returning id into line_id;

    insert into public.floor_line_items (line_id, component_id, job_id, order_id, position, added_by)
    select line_id, c.id, c.job_id, c.order_id,
      row_number() over (
        order by case c.current_phase
          when 'stencil_stuck' then 0 when 'stencil_cut' then 1
          when 'brought_to_line' then 2 when 'cut' then 2 else 3 end,
        c.phase_changed_at nulls last, c.created_at),
      'LINES-1 migration'
    from public.job_components c
    left join public.jobs j on j.id = c.job_id
    where c.track = 'new_stone' and c.component_type <> 'base'
      and c.on_floor = true and c.current_phase <> 'ready_to_set'
      and (j.id is null or j.overall_status not in ('closed', 'cancelled'));

    get diagnostics n_items = row_count;
    raise notice 'LINES-1: Line 1 created with % stones', n_items;
  end if;
end $$;

-- ── DATA 2: existing website_leads → inquiry_status ─────────────────────────
-- Already-actioned ones (their follow-up task was completed) read done; the
-- rest are the backlog the Inquiries tab shows. Empty submissions = junk.
update public.website_leads w
set inquiry_status = 'done',
    actioned_at = coalesce(t.done_at, w.created_at),
    actioned_by = t.done_by
from public.shop_tasks t
where t.id = w.task_id and t.status = 'done' and w.inquiry_status = 'new';

update public.website_leads
set inquiry_status = 'junk', actioned_at = now(), actioned_by = 'INQUIRIES-1 migration'
where status = 'skipped_empty' and inquiry_status = 'new';

-- ── DATA 3: retire the open website-minted Sales tasks (logged, reversible) ─
create table if not exists public._website_task_retire_log (
  task_id uuid primary key,
  retired_at timestamptz not null default now()
);
insert into public._website_task_retire_log (task_id)
select id from public.shop_tasks
where created_by = 'Website' and task_type = 'lead'
  and status in ('open', 'pending') and deleted_at is null
on conflict do nothing;

update public.shop_tasks
set deleted_at = now(), deleted_by = 'INQUIRIES-1 migration', updated_at = now()
where id in (select task_id from public._website_task_retire_log)
  and deleted_at is null;

-- ── VERIFY ──
-- select number, started_at, (select count(*) from floor_line_items i where i.line_id = l.id) from floor_lines l;
-- select inquiry_status, count(*) from website_leads group by 1;
-- select count(*) from _website_task_retire_log;
-- RESTORE the tasks if ever needed:
-- update shop_tasks set deleted_at = null, deleted_by = null where id in (select task_id from _website_task_retire_log);
