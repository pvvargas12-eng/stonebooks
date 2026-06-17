-- =============================================================================
-- 20260618_inventory_source_link.sql — link landed yard stock to its source PR
-- =============================================================================
-- When a Stone PR is received, each line lands as an inventory_stock row.
-- source_bulk_order_id links that row back to the bulk_orders PR so un-receiving
-- can cleanly remove the stock it created (no orphans). Nullable, soft reference
-- (no FK) so deleting a PR never blocks. The existing inventory_stock RLS covers
-- it. Idempotent. App degrades gracefully until this runs (landing still works;
-- reversal just can't auto-remove unlinked stock).
-- =============================================================================

alter table public.inventory_stock add column if not exists source_bulk_order_id uuid;
create index if not exists idx_inventory_stock_source_bulk on public.inventory_stock (source_bulk_order_id);

comment on column public.inventory_stock.source_bulk_order_id is
  'The bulk_orders PR this stock was received from (soft reference; nullable). Set on receive, used for clean un-receive.';
