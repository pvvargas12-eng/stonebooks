-- ── YARD-CATEGORY (2026-10-21, for the 2026-10-22 founding walk) ─────────────
-- Paul: "first by category — grass, hickey, slant, single upright, double
-- upright… then size, shape (oval / flat / serp), polish, color; same for
-- base — BRP, pol top, sawed or saw back."
-- The CATEGORY is the walk's first question; item_type stays the matcher's
-- coarse type (die / base / slant / hickey / grass / backer / other) so every
-- existing reader keeps working. Mapping: single_upright + double_upright →
-- die; the rest map 1:1.
alter table public.inventory_stock add column if not exists category text;
