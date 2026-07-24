-- =============================================================================
-- 20260724_install_list.sql — Installations work-list
-- =============================================================================
-- The hand-picked list of installs Paul is actually going to set (built from
-- the field app; mirror of foundation_list). One row per job on the list.
-- Status itself stays milestone-derived (marking installed drops the job off
-- every install surface); this table only records membership.
-- RLS posture matches the rest of the app: staff full CRUD, partners locked
-- out (restrictive is_staff()), anon locked out (restrictive false).
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.install_list (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id      uuid not null unique references public.jobs(id) on delete cascade,
  added_by    text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists install_list_created_idx
  on public.install_list (created_at);

alter table public.install_list enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'install_list_authenticated_all') then
    create policy install_list_authenticated_all on public.install_list
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_install_list') then
    create policy zz_partner_lockdown_install_list on public.install_list
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_install_list') then
    create policy zz_anon_lockdown_install_list on public.install_list
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select count(*) from install_list;
-- select polname from pg_policy where polrelid = 'install_list'::regclass;
