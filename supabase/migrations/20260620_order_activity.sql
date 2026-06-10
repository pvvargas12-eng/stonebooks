-- =============================================================================
-- 20260620_order_activity.sql — Per-order activity log (changes / activity / tasks)
-- =============================================================================
-- Order-level activity timeline at the bottom of each Order Detail view:
--   • 'change'   — auto-logged status/milestone transitions (old -> new + actor)
--   • 'activity' — manual free-text notes
--   • 'task'     — note + assignee + optional due date; open until marked done
--
-- job_events was NOT reused: it is job-keyed (FK to jobs.id), and many orders have
-- no job yet (pre-contract). This table is order-keyed so it works for every order.
-- Tasks are first-class rows (not JSONB) so a future "all open tasks for <person>"
-- view can query them cross-order — the reason JSONB was rejected.
--
-- RLS mirrors the app's lockdown posture: STAFF (is_staff()) get full access; no
-- public/anon policy (anon is denied by default once RLS is on; partners are
-- excluded by is_staff()).
--
-- APPLY MANUALLY in Supabase Studio. Idempotent — safe to re-run.
-- =============================================================================

-- is_staff() — same definition used across the app's lockdown (idempotent).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.order_activity (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',  -- Shevchenko tenant
  order_id    uuid not null references public.orders(id) on delete cascade,
  type        text not null check (type in ('change','activity','task')),
  field       text,                       -- 'change': what changed (e.g. "Stone status")
  old_value   text,                       -- 'change': prior value
  new_value   text,                       -- 'change': new value
  note        text,                       -- 'activity'/'task' free text
  actor       text,                       -- who created the entry (staff name)
  assignee    text,                       -- 'task': who it's assigned to
  task_status text check (task_status is null or task_status in ('open','done')),
  due_date    date,                        -- 'task': optional due date
  created_at  timestamptz not null default now()
);

-- Per-order, newest-first render.
create index if not exists order_activity_order_idx
  on public.order_activity (order_id, created_at desc);
-- Future "open tasks for <person>" cross-order view.
create index if not exists order_activity_open_tasks_idx
  on public.order_activity (assignee, task_status)
  where type = 'task' and task_status = 'open';

alter table public.order_activity enable row level security;

drop policy if exists order_activity_staff_all on public.order_activity;
create policy order_activity_staff_all on public.order_activity
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- VERIFY (run after applying):
--   • As STAFF: insert + select a row — succeeds:
--       insert into order_activity (order_id, type, note, actor)
--         values ((select id from orders limit 1), 'activity', 'verify row', 'Paul');
--       select id, type, note from order_activity order by created_at desc limit 1;
--       delete from order_activity where note = 'verify row';
--   • Confirm RLS is on:
--       select relrowsecurity from pg_class where relname = 'order_activity';  -- t
-- =============================================================================
