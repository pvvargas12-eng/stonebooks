-- =============================================================================
-- 20260616_quote_events.sql  (ALREADY APPLIED — recorded for version control)
-- Quote Hub Layer 2 + cemetery support:
--   • orders.quote_events           jsonb default '[]'   (append-only log)
--   • cemetery_orders.quote_status  text  default 'draft'
--   • cemetery_orders.quote_events  jsonb default '[]'
-- quote_events entries: { type, by, at, text }, type ∈
--   sent | approved | changes_requested | sent_to_customer | note
-- The app degrades gracefully if these are absent. Idempotent.
-- =============================================================================

alter table public.orders
  add column if not exists quote_events jsonb not null default '[]'::jsonb;

alter table public.cemetery_orders
  add column if not exists quote_status text not null default 'draft';
alter table public.cemetery_orders
  add column if not exists quote_events jsonb not null default '[]'::jsonb;
