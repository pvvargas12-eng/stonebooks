-- =============================================================================
-- 20261008_install_reminders.sql — INSTALL-PLANNER-2: custom reminders
-- =============================================================================
-- Paul 2026-10-08: "i need to be able to add custom blockers — things like
-- Need Base Insc, all St Gertrude bases need an insc — and i don't want it
-- just to be a blocker but a reminder, so it's good to keep on."
-- A reminder hangs on ONE JOB (this stone) or on a CEMETERY (every stone set
-- there wears it). It never gates anything — it's a note the crew and the
-- office see on the Install Planner, the scheduled-installs list and the set
-- list, until someone ticks it done. RLS: the standard staff trio. Idempotent.
-- =============================================================================
create table if not exists public.install_reminders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id       uuid references public.jobs(id) on delete cascade,
  cemetery_id  uuid references public.cemeteries(id) on delete cascade,
  text         text not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  done_at      timestamptz,
  done_by      text,
  constraint install_reminders_target check (job_id is not null or cemetery_id is not null)
);
create index if not exists install_reminders_job_idx on public.install_reminders (job_id) where done_at is null;
create index if not exists install_reminders_cem_idx on public.install_reminders (cemetery_id) where done_at is null;

alter table public.install_reminders enable row level security;
do $$
declare t text := 'install_reminders';
begin
  if not exists (select 1 from pg_policy where polname = t || '_authenticated_all') then
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;
-- VERIFY: select count(*) from pg_policy where polrelid = 'install_reminders'::regclass;
