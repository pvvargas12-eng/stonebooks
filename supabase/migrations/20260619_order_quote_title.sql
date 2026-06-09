-- =============================================================================
-- 20260619_order_quote_title.sql — Quote 1's editable display name
-- =============================================================================
-- orders.quote_title: the editable name for Quote 1 in the multi-quote editor.
-- Quote 1 is the order's live primary columns (not an entry in orders.quotes),
-- so its name needs its own home. Additional quotes keep their name in
-- orders.quotes[].title; this is the single source of truth for Quote 1's name.
-- NULL = show the default label "Quote 1". The app degrades gracefully if this
-- column is absent (saveOrder strips it and retries; reads fall back to null).
-- Idempotent. Apply in Supabase Studio (manual).
-- =============================================================================

alter table public.orders
  add column if not exists quote_title text;
