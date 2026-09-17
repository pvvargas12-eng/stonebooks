-- =============================================================================
-- 20260917_hot_list_items.sql — Sprint HOT-LIST-2: the curated Hot List
-- =============================================================================
-- Paul 2026-09-17: "the hotlist is terrible I want that to be a tab even above
-- Today in a different color so it stands out and you can add and remove things
-- from the hotlist. Stones to be blasted, To be set, inscriptions, acid wash,
-- other... FOR ADMIN I WANT TO BE ABLE TO ADD HOT THINGS TO THEM AS WELL."
--
-- Unlike foundation_list/install_list (membership mirrors of milestone state),
-- the hot list is a HAND-CURATED priority board: Paul adds what's hot, removes
-- what's not. Items may link a job/order (chips + click-through enrich from the
-- live stores) or be free text (admin/other lanes). Done keeps the row as
-- history (done_at) — the board only shows open items.
-- RLS posture: staff full CRUD, partners + anon locked out. Idempotent.
-- =============================================================================

create table if not exists public.hot_list_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  category    text not null check (category in ('blast','set','inscription','acid_wash','admin','other')),
  title       text not null,
  note        text,
  job_id      uuid references public.jobs(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete cascade,
  added_by    text,
  done_at     timestamptz,
  done_by     text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- One OPEN row per (category, job) — a done item can come back hot later.
create unique index if not exists hot_list_items_open_job_uniq
  on public.hot_list_items (category, job_id)
  where job_id is not null and done_at is null;

create index if not exists hot_list_items_open_idx
  on public.hot_list_items (category, created_at)
  where done_at is null;

alter table public.hot_list_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'hot_list_items_authenticated_all') then
    create policy hot_list_items_authenticated_all on public.hot_list_items
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_hot_list_items') then
    create policy zz_partner_lockdown_hot_list_items on public.hot_list_items
      as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_hot_list_items') then
    create policy zz_anon_lockdown_hot_list_items on public.hot_list_items
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select count(*) from hot_list_items;
-- select polname from pg_policy where polrelid = 'hot_list_items'::regclass;
