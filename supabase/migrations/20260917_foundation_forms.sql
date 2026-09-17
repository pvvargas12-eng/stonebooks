-- =============================================================================
-- 20260917_foundation_forms.sql — Sprint FDN-EFORM: the Foundation E-Form
-- =============================================================================
-- Paul 2026-09-17: "I need this filled out For each Shevco Foundation. I will
-- not do a foundation if this is not done. then when im looking at the
-- foundations I can see all this data when i click on each one in SB and in
-- SB Field." (His paper FOUNDATION sheet, digitized.)
--
-- One row per JOB (the dig-list key). `data` jsonb carries the form fields:
--   cemetery, customer_name, phone, cell, deceased, dod, location,
--   stone_size, foundation_size,
--   grave_config: 'single' | 'double_deep' | 'side_x_side',
--   remains: 'cremains' | 'full_body',
--   veteran_marker_temp: 'Y' | 'N',
--   stone_type: 'slant' | 'grass_marker' | 'hickey' | 'upright',
--   must_have_map: 'yes' | 'no',  map_note
-- completed_at/by = the operator saved it (the NO E-FORM chip reads this).
-- RLS posture: staff full CRUD, partners + anon locked out. Idempotent.
-- =============================================================================

create table if not exists public.foundation_forms (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id        uuid not null unique references public.jobs(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  completed_at  timestamptz,
  completed_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists foundation_forms_order_idx
  on public.foundation_forms (order_id) where order_id is not null;

alter table public.foundation_forms enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'foundation_forms_authenticated_all') then
    create policy foundation_forms_authenticated_all on public.foundation_forms
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_foundation_forms') then
    create policy zz_partner_lockdown_foundation_forms on public.foundation_forms
      as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()));
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_foundation_forms') then
    create policy zz_anon_lockdown_foundation_forms on public.foundation_forms
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select count(*) from foundation_forms;
-- select polname from pg_policy where polrelid = 'foundation_forms'::regclass;
