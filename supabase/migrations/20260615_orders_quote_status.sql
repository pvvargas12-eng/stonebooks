-- =============================================================================
-- 20260615_orders_quote_status.sql
-- Quote Hub: owner-approval lifecycle on orders.
--   draft → pending_review → approved / needs_changes → sent_to_customer
-- The app degrades gracefully if this isn't applied yet (the "Send to Quote Hub"
-- write surfaces a friendly "apply the migration" message; chips read 'draft').
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: alter table public.orders drop column if exists quote_status;
-- =============================================================================

alter table public.orders
  add column if not exists quote_status text not null default 'draft';

-- Optional: a partial index so the Quote Hub's pending queue stays fast as
-- orders grow (only indexes the rows the hub queries).
create index if not exists orders_quote_status_pending_idx
  on public.orders (quote_status)
  where quote_status is not null and quote_status <> 'draft';
