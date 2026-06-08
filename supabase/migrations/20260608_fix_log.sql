-- =============================================================================
-- 20260608_fix_log.sql  (Fix Log — internal bug / request tracker)
-- =============================================================================
-- Soft-launch triage tracker: staff file bugs / edits / build ideas / questions;
-- the owner triages status + priority. Two tables + a unified timeline (comments
-- AND field-change events both live in fix_log_comments).
--
-- RLS: STAFF (is_staff()) read/write on both tables. The app is deploy-safe — the
-- Fix Log tab shows a "run the migration" empty state until this is applied, so
-- shipping the code before the SQL never crashes.
--
-- APPLY MANUALLY in Studio (already applied 2026-06-08). Idempotent — safe to re-run.
-- ROLLBACK:
--   drop trigger if exists trg_fix_log_items_updated_at on public.fix_log_items;
--   drop function if exists public.set_fix_log_updated_at();
--   drop table if exists public.fix_log_comments;
--   drop table if exists public.fix_log_items;
-- =============================================================================

-- is_staff(): authenticated AND not a vendor-portal partner. (Created elsewhere;
-- re-created here so this migration is self-contained / order-independent.)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

-- ── Items ────────────────────────────────────────────────────────────────────
create table if not exists public.fix_log_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  title       text not null,
  description text,
  type        text not null default 'bug'
              check (type in ('bug', 'edit', 'build_idea', 'question')),
  priority    text not null default 'normal'
              check (priority in ('low', 'normal', 'high', 'urgent')),
  status      text not null default 'new'
              check (status in ('new', 'in_review', 'working', 'fixed', 'not_fixing')),
  reported_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists fix_log_items_status_idx     on public.fix_log_items (status);
create index if not exists fix_log_items_type_idx        on public.fix_log_items (type);
create index if not exists fix_log_items_priority_idx    on public.fix_log_items (priority);
create index if not exists fix_log_items_updated_at_idx  on public.fix_log_items (updated_at desc);

-- ── Timeline (comments + field-change events) ────────────────────────────────
-- kind = 'comment' for a human note; otherwise the changed field
-- ('status' | 'priority' | 'type' | 'title' | 'description' | 'created') with an
-- auto-generated body like "Status: Working On It -> Fixed".
create table if not exists public.fix_log_comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.fix_log_items(id) on delete cascade,
  kind       text not null default 'comment',
  body       text,
  author     text,
  created_at timestamptz not null default now()
);

create index if not exists fix_log_comments_item_idx on public.fix_log_comments (item_id, created_at);

-- ── updated_at trigger on items ──────────────────────────────────────────────
create or replace function public.set_fix_log_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_fix_log_items_updated_at on public.fix_log_items;
create trigger trg_fix_log_items_updated_at
  before update on public.fix_log_items
  for each row execute function public.set_fix_log_updated_at();

-- ── RLS — staff only ─────────────────────────────────────────────────────────
alter table public.fix_log_items    enable row level security;
alter table public.fix_log_comments enable row level security;

drop policy if exists fix_log_items_staff_all on public.fix_log_items;
create policy fix_log_items_staff_all on public.fix_log_items
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists fix_log_comments_staff_all on public.fix_log_comments;
create policy fix_log_comments_staff_all on public.fix_log_comments
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- PostgREST: pick up the new tables immediately.
notify pgrst, 'reload schema';

-- VERIFY:
--   select count(*) from fix_log_items;     -- 0 (or your rows)
--   select count(*) from fix_log_comments;  -- 0
