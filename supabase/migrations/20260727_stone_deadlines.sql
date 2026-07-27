-- =============================================================================
-- 20260727_stone_deadlines.sql — Sabina's STONE Deadlines chart, staged (RECON-2)
-- =============================================================================
-- Paul 2026-07-27: the deadline workbook's OPEN stones (white = not cut,
-- blue = stencil cut, orange = has photo; green = finished, not imported)
-- land in this staging table. The Reconcile tab compares them to orders and
-- PAUL clicks every change — nothing here writes to orders by itself.
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.stone_deadlines (
  id               uuid primary key default gen_random_uuid(),
  family           text not null,
  family_raw       text,
  detail           text,
  due_month        date not null,           -- first of the sheet's month column
  proposed_date    date not null,           -- explicit date in the cell, else month-end
  sheet_color      text not null,           -- white | blue | orange
  source           text not null default 'STONE Deadlines.xlsx 2026-07-27',
  matched_order_id uuid references public.orders(id) on delete set null,
  applied_at       timestamptz,
  applied_by       text,
  dismissed_at     timestamptz,
  dismissed_by     text,
  created_at       timestamptz not null default now(),
  unique (family, due_month)
);

alter table public.stone_deadlines enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'stone_deadlines_authenticated_all') then
    create policy stone_deadlines_authenticated_all on public.stone_deadlines
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_stone_deadlines') then
    create policy zz_partner_lockdown_stone_deadlines on public.stone_deadlines
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_stone_deadlines') then
    create policy zz_anon_lockdown_stone_deadlines on public.stone_deadlines
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
