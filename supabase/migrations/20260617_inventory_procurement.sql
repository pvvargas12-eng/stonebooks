-- =============================================================================
-- 20260617_inventory_procurement.sql — Procurement Phase 1 (Stone PR)
-- =============================================================================
-- Additive: a new suppliers table, a new bulk_order_items table, and two columns
-- on the existing bulk_orders (supplier_id + status). Nothing else is touched.
-- The app degrades gracefully until this runs. RLS mirrors inventory_stock exactly
-- (staff full CRUD; partners + anon zero). Idempotent.
-- =============================================================================

-- ── 1 · SUPPLIERS (new) ──────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  name           text not null,
  contact_name   text,
  phone          text,
  email          text,
  terms          text,
  lead_time_days integer,
  kinds          text[] not null default '{}',   -- stone / photo / etching / bronze
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_suppliers_active on public.suppliers (active);

alter table public.suppliers enable row level security;
drop policy if exists "suppliers_staff_all"     on public.suppliers;
create policy "suppliers_staff_all"     on public.suppliers as permissive  for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "zz_anon_deny"            on public.suppliers;
create policy "zz_anon_deny"            on public.suppliers as restrictive for all to anon          using (false)      with check (false);
drop policy if exists "zz_partner_lockdown"     on public.suppliers;
create policy "zz_partner_lockdown"     on public.suppliers as restrictive for all to authenticated using (is_staff()) with check (is_staff());

-- ── 2 · bulk_orders extension ────────────────────────────────────────────────
-- supplier_id links a PO to a supplier (soft FK, ON DELETE SET NULL so deleting a
-- supplier never blocks). status drives the pipeline: null/'ordered' = ordered,
-- 'draft' = a PR not yet sent, received_at set = received. Existing scheduler POs
-- have status NULL → treated as ordered (unchanged behaviour).
alter table public.bulk_orders add column if not exists supplier_id uuid;
alter table public.bulk_orders add column if not exists status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bulk_orders_supplier_id_fkey') then
    alter table public.bulk_orders
      add constraint bulk_orders_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id) on delete set null;
  end if;
end $$;
create index if not exists idx_bulk_orders_status      on public.bulk_orders (status);
create index if not exists idx_bulk_orders_supplier_id on public.bulk_orders (supplier_id);

-- ── 3 · bulk_order_items (new) ───────────────────────────────────────────────
-- Per-line specs for a PR. Free-form text (same verbatim style as inventory_stock).
create table if not exists public.bulk_order_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  bulk_order_id uuid not null references public.bulk_orders(id) on delete cascade,
  kind          text,
  family_name   text,
  order_id      uuid,                    -- the customer order this line is for (soft ref)
  color         text,
  size          text,
  top           text,
  sides         text,
  quantity      integer not null default 1,
  notes         text,
  received_qty  integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_bulk_order_items_bulk on public.bulk_order_items (bulk_order_id);

alter table public.bulk_order_items enable row level security;
drop policy if exists "bulk_order_items_staff_all" on public.bulk_order_items;
create policy "bulk_order_items_staff_all" on public.bulk_order_items as permissive  for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists "zz_anon_deny"             on public.bulk_order_items;
create policy "zz_anon_deny"             on public.bulk_order_items as restrictive for all to anon          using (false)      with check (false);
drop policy if exists "zz_partner_lockdown"      on public.bulk_order_items;
create policy "zz_partner_lockdown"      on public.bulk_order_items as restrictive for all to authenticated using (is_staff()) with check (is_staff());

comment on table public.suppliers        is 'Material suppliers (stone/photo/etching/bronze). Staff-internal; RLS mirrors inventory_stock.';
comment on table public.bulk_order_items is 'Per-line specs for a purchase request (bulk_orders). Free-form verbatim text.';
