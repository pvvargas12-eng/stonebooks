-- =============================================================================
-- 20260714_shop_tasks.sql — TODAY GOD MODE substrate
-- =============================================================================
-- 1. shop_tasks — free-standing tasks ("don't tell me, task me"): an assignee,
--    an optional order link, a due date. NOT order_activity (those physically
--    require an order). Deleting is a real delete (the reply loop is the
--    audit trail while open).
-- 2. shop_task_replies — comments on a task. A reply is an inbox item for the
--    other side (author == assignee → goes to created_by, else → assignee)
--    until handled_at is stamped.
-- 3. approval_links.emailed_at / emailed_to — stamped when the approval email
--    is actually SENT from the composer, so "was this ever emailed?" is a
--    column read, not an inference.
-- RLS: staff full CRUD, partner + anon locked out (three-role parity).
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.shop_tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  title         text not null,
  assignee      text not null,
  created_by    text,
  order_id      uuid references public.orders(id) on delete set null,
  due_date      date,
  status        text not null default 'open' check (status in ('open', 'done')),
  done_at       timestamptz,
  done_by       text,
  snoozed_until date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists shop_tasks_status_idx on public.shop_tasks (status, assignee);

create table if not exists public.shop_task_replies (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.shop_tasks(id) on delete cascade,
  author      text not null,
  body        text not null,
  handled_at  timestamptz,
  handled_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists shop_task_replies_task_idx on public.shop_task_replies (task_id, created_at);

alter table public.approval_links add column if not exists emailed_at timestamptz;
alter table public.approval_links add column if not exists emailed_to text;

alter table public.shop_tasks enable row level security;
alter table public.shop_task_replies enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'shop_tasks_authenticated_all') then
    create policy shop_tasks_authenticated_all on public.shop_tasks
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_shop_tasks') then
    create policy zz_partner_lockdown_shop_tasks on public.shop_tasks
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_shop_tasks') then
    create policy zz_anon_lockdown_shop_tasks on public.shop_tasks
      as restrictive for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policy where polname = 'shop_task_replies_authenticated_all') then
    create policy shop_task_replies_authenticated_all on public.shop_task_replies
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_shop_task_replies') then
    create policy zz_partner_lockdown_shop_task_replies on public.shop_task_replies
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_shop_task_replies') then
    create policy zz_anon_lockdown_shop_task_replies on public.shop_task_replies
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select count(*) from shop_tasks; select count(*) from shop_task_replies;
-- select column_name from information_schema.columns where table_name='approval_links' and column_name in ('emailed_at','emailed_to');
