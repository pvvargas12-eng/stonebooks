-- =============================================================================
-- 20260618_order_quotes.sql — Multi-quote substrate (Quote 1 + additional quotes)
-- =============================================================================
-- Adds orders.quotes: a JSONB array of ADDITIONAL quotes beyond Quote 1.
--   Quote 1  = the order's own primary columns (unchanged).
--   quotes[] = [{ id, title, spec }], spec = extractSpecFromOrder() snapshot.
--             NO cached lineItems/total — every quote is priced live by running
--             applySpecToOrder(order, quote.spec) through the pricing engine.
--
-- The app degrades gracefully if this column is absent: rowToOrder reads it with
-- a [] fallback, and saveOrder() strips `quotes` and retries if the write fails
-- on a missing column. Idempotent. Apply in Supabase Studio (manual).
--
-- NOTE: the promotion sprint (next) adds a SEPARATE orders.quotes_archive column
-- for the pre-promotion snapshot — quote_events is a typed activity log and must
-- NOT be repurposed as a quote container/archive.
-- =============================================================================

alter table public.orders
  add column if not exists quotes jsonb not null default '[]'::jsonb;
