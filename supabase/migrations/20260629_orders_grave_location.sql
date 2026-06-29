-- =============================================================================
-- 20260629_orders_grave_location.sql
-- Collapse the seven structured grave/plot location columns into ONE free-text line.
-- =============================================================================
-- Every cemetery formats its location differently, so the editors now offer a single
-- free-text "Grave location" box that writes here. The seven legacy columns
-- (plot_section / plot_block / plot_lot / plot_row / plot_space / plot_grave /
-- plot_level) are KEPT and untouched — composeGraveLocation() reads them as a
-- fallback so existing orders never go blank. No backfill: a row with an empty
-- grave_location still displays its composed legacy parts. Idempotent.
--
-- NOT affected: plot_type, foundation_type (the structured dropdowns), plot_lat /
-- plot_lng (GPS pin), plot_pin_notes / plot_other (free-text notes).
-- =============================================================================

alter table public.orders
  add column if not exists grave_location text;

comment on column public.orders.grave_location is
  'Single free-text grave/plot location (however the cemetery formats it). When '
  'empty, composeGraveLocation() falls back to the legacy plot_section/block/lot/'
  'row/space/grave/level columns so nothing already stored goes blank.';
