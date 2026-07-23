-- =============================================================================
-- 20260723_pr_upgrade.sql — PR workspace + recorded PRs + reconcile
-- =============================================================================
-- Paul's PR overhaul (2026-07-23):
--   • bulk_order_items gains the structured columns his vendor sheets use
--     (Color / TYPE / Size / SPECS), a per-line STOCK flag ("ordered to have" —
--     lands straight into yard stock on receive), and an optional unit price.
--   • bulk_orders.recorded — a RECORDED PR documents a purchase that already
--     happened outside Stonebooks. Recorded PRs NEVER write to orders: no
--     Submit, no milestone flips on cancel/delete (enforced in the data layer,
--     flagged here in data).
--   • pr_reconcile_dismissals — the Reconcile tab's "Disregard" memory, one row
--     per (line, check). Reconcile never auto-writes; every fix is Paul's click.
-- Idempotent — safe to re-run.
-- =============================================================================

alter table public.bulk_order_items add column if not exists item_type text;
alter table public.bulk_order_items add column if not exists specs text;
alter table public.bulk_order_items add column if not exists is_stock boolean not null default false;
alter table public.bulk_order_items add column if not exists unit_price numeric;

alter table public.bulk_orders add column if not exists recorded boolean not null default false;

create table if not exists public.pr_reconcile_dismissals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  item_id      uuid not null references public.bulk_order_items(id) on delete cascade,
  check_kind   text not null,
  dismissed_by text,
  created_at   timestamptz not null default now(),
  unique (item_id, check_kind)
);

create index if not exists pr_reconcile_dismissals_item_idx
  on public.pr_reconcile_dismissals (item_id);

alter table public.pr_reconcile_dismissals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'pr_recdis_authenticated_all') then
    create policy pr_recdis_authenticated_all on public.pr_reconcile_dismissals
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_pr_recdis') then
    create policy zz_partner_lockdown_pr_recdis on public.pr_reconcile_dismissals
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_pr_recdis') then
    create policy zz_anon_lockdown_pr_recdis on public.pr_reconcile_dismissals
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='bulk_order_items' and column_name in ('item_type','specs','is_stock','unit_price');
-- select column_name from information_schema.columns where table_name='bulk_orders' and column_name='recorded';
-- select polname from pg_policy where polrelid = 'pr_reconcile_dismissals'::regclass;
