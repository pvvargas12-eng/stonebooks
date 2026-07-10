-- =============================================================================
-- 2026-07-10 — Die + Base per-piece stone ordering status (Paul)
-- =============================================================================
-- Sometimes the die is in stock and the base isn't ordered yet — and vice versa.
-- Each piece now carries its own ordering status on the ORDER:
--   'not_ordered' (red) | 'ordered' (blue) | 'in_stock' (green)
-- The combined job-level stone status (milestone ladder) stays the LEAST-ready
-- piece; the Monument card on OrderDetail is the write surface.
-- Nullable on purpose: legacy orders fall back to the milestone-derived status.

alter table public.orders add column if not exists die_stone_status text;
alter table public.orders add column if not exists base_stone_status text;
