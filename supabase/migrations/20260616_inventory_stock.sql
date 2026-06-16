-- =============================================================================
-- 20260616_inventory_stock.sql — Inventory module Phase 1: stock foundation
-- =============================================================================
-- Staff-internal yard-stock table. All text columns are FREE-FORM and preserved
-- verbatim — color shorthand ("Md Barre Gray", "Mahagony"), exact size strings
-- ("2-6x1-0x0-6"), and locations ("1.2 A", "IN FRONT S2", "COURTYARD",
-- "Next Big Truck") are NEVER parsed or normalized. One row per location+spec;
-- identical stones at a location collapse to a count (quantity).
--
-- RLS mirrors the existing staff-internal pattern EXACTLY (verified against
-- order_activity + bulk_orders via pg_policies, Step 0 on 2026-06-16):
--   • inventory_stock_staff_all  — PERMISSIVE,  authenticated, ALL, is_staff()
--   • zz_anon_deny               — RESTRICTIVE, anon,          ALL, false
--   • zz_partner_lockdown        — RESTRICTIVE, authenticated, ALL, is_staff()
-- Three-role end state: anon = 0, partner = 0, staff = full CRUD.
-- RLS enabled, NOT forced (matches order_activity / bulk_orders). Idempotent.
-- =============================================================================

create table if not exists public.inventory_stock (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  item_type   text,
  color       text,
  size        text,
  top         text,
  sides       text,
  back        text,
  location    text,
  quantity    integer not null default 1,
  status      text not null default 'available',
  assigned_to text,
  notes       text,
  photo_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Common-filter / forward-looking indexes (cheap; table is small).
create index if not exists idx_inventory_stock_tenant_id on public.inventory_stock (tenant_id);
create index if not exists idx_inventory_stock_item_type on public.inventory_stock (item_type);
create index if not exists idx_inventory_stock_status    on public.inventory_stock (status);
create index if not exists idx_inventory_stock_location  on public.inventory_stock (location);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.inventory_stock enable row level security;
-- (intentionally NOT forced — matches order_activity / bulk_orders)

-- PERMISSIVE: staff full CRUD (mirrors order_activity_staff_all).
drop policy if exists "inventory_stock_staff_all" on public.inventory_stock;
create policy "inventory_stock_staff_all"
  on public.inventory_stock
  as permissive
  for all
  to authenticated
  using (is_staff())
  with check (is_staff());

-- RESTRICTIVE: public anon key gets zero (mirrors bulk_orders zz_anon_deny).
drop policy if exists "zz_anon_deny" on public.inventory_stock;
create policy "zz_anon_deny"
  on public.inventory_stock
  as restrictive
  for all
  to anon
  using (false)
  with check (false);

-- RESTRICTIVE: partners blocked (mirrors bulk_orders zz_partner_lockdown).
drop policy if exists "zz_partner_lockdown" on public.inventory_stock;
create policy "zz_partner_lockdown"
  on public.inventory_stock
  as restrictive
  for all
  to authenticated
  using (is_staff())
  with check (is_staff());

comment on table public.inventory_stock is
  'Inventory P1 — physical yard stock. Free-form text (sizes/locations preserved verbatim). tenant_id is the forward-looking multi-tenant default. RLS: staff full CRUD; partners + anon zero (mirrors order_activity + bulk_orders).';

-- ── Verify (run after applying) ──────────────────────────────────────────────
-- select policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies where schemaname='public' and tablename='inventory_stock'
--   order by policyname;
--   EXPECTED:
--     inventory_stock_staff_all | PERMISSIVE  | {authenticated} | ALL | is_staff() | is_staff()
--     zz_anon_deny              | RESTRICTIVE | {anon}          | ALL | false      | false
--     zz_partner_lockdown       | RESTRICTIVE | {authenticated} | ALL | is_staff() | is_staff()
-- select relrowsecurity, relforcerowsecurity from pg_class where relname='inventory_stock';
--   EXPECTED: true, false
