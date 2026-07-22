-- =============================================================================
-- 20260722_stencil_cut_list.sql — the hand-built stencil CUT LIST
-- =============================================================================
-- Paul (2026-07-22): "for stencil cut to be on the list also stone must be
-- here and layout must be approved… I don't want to auto add to production —
-- I already told you I want to build my lists." Mirror of foundation_list:
-- membership only; cut state stays milestone-derived (stencil_cut via the
-- stone ladder writers). RLS parity: staff full, partners/anon locked out.
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.stencil_cut_list (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id      uuid not null unique references public.jobs(id) on delete cascade,
  added_by    text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists stencil_cut_list_created_idx
  on public.stencil_cut_list (created_at);

alter table public.stencil_cut_list enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'stencil_cut_list_authenticated_all') then
    create policy stencil_cut_list_authenticated_all on public.stencil_cut_list
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_stencil_cut_list') then
    create policy zz_partner_lockdown_stencil_cut_list on public.stencil_cut_list
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_stencil_cut_list') then
    create policy zz_anon_lockdown_stencil_cut_list on public.stencil_cut_list
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
