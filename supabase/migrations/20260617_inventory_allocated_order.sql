-- =============================================================================
-- 20260617_inventory_allocated_order.sql — link an allocated stone to its order
-- =============================================================================
-- Adds allocated_order_id to inventory_stock so an allocated stone knows WHICH
-- order it's reserved to (not just the family name). Nullable, soft reference (no
-- FK) so archiving/deleting an order never blocks releasing stock. The existing
-- inventory_stock RLS (20260616) already covers this column — no policy change.
-- Idempotent. The app degrades gracefully until this runs (allocation works with
-- the family link; the order link starts persisting once the column exists).
-- =============================================================================

alter table public.inventory_stock add column if not exists allocated_order_id uuid;

create index if not exists idx_inventory_stock_allocated_order on public.inventory_stock (allocated_order_id);

comment on column public.inventory_stock.allocated_order_id is
  'Order this stone is allocated to (soft reference; nullable). Set on allocate, cleared on release.';
