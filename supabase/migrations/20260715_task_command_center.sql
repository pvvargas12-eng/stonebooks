-- =============================================================================
-- 20260715_task_command_center.sql — TASK COMMAND CENTER substrate, part 2
-- =============================================================================
-- shop_tasks becomes the ONE task store for the whole shop (Paul: "tasks
-- created in leads and other areas must also show up in the Today tab —
-- don't want anything getting lost").
--
--  • tasked_by      — who assigned it (defaults to created_by; overridable)
--  • assignee_kind  — 'person' | 'department' (departments: Admin, Design,
--                     Sales, Production, Installation)
--  • task_type      — 'general' | 'lead' | 'order' | 'production' | 'design'
--                     | 'check_job' (soft vocabulary — app validates; no
--                     check constraint so new types don't need DDL)
--  • status         — gains 'pending' (worked/blocked, not done)
--  • attachments    — jsonb [{name,url,path}]; order-linked task uploads go
--                     into the order's own storage folder so they appear in
--                     the order attachment list too
--  • details        — jsonb per-type payload (check_job: cemeteryId,
--                     cemeteryName)
--  • deleted_at/by  — soft delete. Anyone may delete any task (Paul's rule),
--                     so keep a trail instead of a hard delete.
--  • legacy_activity_id — the order_activity.id a migrated task came from;
--                     unique, so the backfill below is idempotent.
--
-- Backfill: every order_activity type='task' row is copied in (open →
-- open, in_progress → pending, done → done). Originals stay in place,
-- dormant — the app's task reads/writes all move to shop_tasks.
-- Idempotent — safe to re-run (re-running also catches tasks created
-- between first apply and the code deploy).
-- =============================================================================

alter table public.shop_tasks add column if not exists tasked_by text;
alter table public.shop_tasks add column if not exists assignee_kind text not null default 'person';
alter table public.shop_tasks add column if not exists task_type text not null default 'general';
alter table public.shop_tasks add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.shop_tasks add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.shop_tasks add column if not exists deleted_at timestamptz;
alter table public.shop_tasks add column if not exists deleted_by text;
alter table public.shop_tasks add column if not exists legacy_activity_id uuid unique;

alter table public.shop_tasks drop constraint if exists shop_tasks_status_check;
alter table public.shop_tasks add constraint shop_tasks_status_check
  check (status in ('open', 'pending', 'done'));

update public.shop_tasks set tasked_by = created_by
  where tasked_by is null and created_by is not null;

create index if not exists shop_tasks_order_idx on public.shop_tasks (order_id) where order_id is not null;
create index if not exists shop_tasks_type_idx on public.shop_tasks (task_type, status);

-- ── Backfill legacy order_activity tasks ────────────────────────────────────
-- Lead detection matches ensureLeadCadence: unsigned + still in an
-- uncontracted pipeline status ⇒ the task belongs to a lead.
insert into public.shop_tasks
  (title, assignee, created_by, tasked_by, order_id, due_date,
   status, done_at, created_at, updated_at, details, task_type, legacy_activity_id)
select
  coalesce(nullif(trim(a.note), ''), 'Task'),
  coalesce(nullif(trim(a.assignee), ''), nullif(trim(a.actor), ''), 'Paul'),
  a.actor,
  a.actor,
  a.order_id,
  a.due_date,
  case a.task_status when 'in_progress' then 'pending'
                     when 'done'        then 'done'
                     else 'open' end,
  case when a.task_status = 'done' then a.created_at else null end,  -- no completed_at existed; best available
  a.created_at,
  now(),
  case when a.field is not null then jsonb_build_object('phase', a.field) else '{}'::jsonb end,  -- rail tasks group by pipeline phase
  case when a.kind in ('design', 'layout') then a.kind
       when o.signed_at is null and o.status in ('draft', 'scoping', 'quoted') then 'lead'
       else 'order' end,
  a.id
from public.order_activity a
left join public.orders o on o.id = a.order_id
where a.type = 'task'
on conflict (legacy_activity_id) do nothing;

-- ── VERIFY ──
-- select task_type, status, count(*) from shop_tasks group by 1, 2 order by 1, 2;
-- select count(*) from order_activity where type = 'task';  -- should equal count of legacy_activity_id not null
