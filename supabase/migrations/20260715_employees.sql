-- =============================================================================
-- 20260715_employees.sql — TASK COMMAND CENTER substrate, part 1
-- =============================================================================
-- employees — the settings-managed staff roster. Replaces the two divergent
-- hardcoded lists (STAFF_NAMES in stonebooksData.js, TEAM_ROSTER in team.js):
-- both arrays are overlaid in place from this table at boot (salesOptions
-- pattern), so every existing picker/actor-stamp keeps working.
--   • name is the identity used in text stamps app-wide — unique per tenant.
--   • department: Admin | Design | Sales | Production | Installation (free
--     text on purpose; the app validates against DEPARTMENTS).
--   • Soft-delete only (is_active) — old task/payment/note stamps must keep
--     resolving to a person.
-- RLS: staff full CRUD, partner + anon locked out (three-role parity).
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  name        text not null,
  department  text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists employees_active_idx on public.employees (is_active, sort_order);

alter table public.employees enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'employees_authenticated_all') then
    create policy employees_authenticated_all on public.employees
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_employees') then
    create policy zz_partner_lockdown_employees on public.employees
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_employees') then
    create policy zz_anon_lockdown_employees on public.employees
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- Seed: union of STAFF_NAMES + TEAM_ROSTER ('Cathy' and 'Catherina' are the
-- same person — seeded once as 'Catherina', the newer canonical spelling).
insert into public.employees (name, sort_order) values
  ('Catherina', 10),
  ('Lonnie',    20),
  ('Chelsea',   30),
  ('Sabina',    40),
  ('Paul',      50),
  ('Collin',    60),
  ('Denise',    70),
  ('Alex',      80),
  ('Leo',       90),
  ('Bill',     100),
  ('Maria',    110)
on conflict (tenant_id, name) do nothing;

-- ── VERIFY ──
-- select name, department, sort_order, is_active from employees order by sort_order;
