-- Cemetery Orders — pricing snapshot + tax / CC-fee toggles
-- =============================================================================
-- Three additive columns on cemetery_orders for the redesigned wizard:
--   • cemetery_pricing_snapshot — for CUSTOM cemeteries (operator-added), a
--     frozen copy of the price list (seeded from Clover Leaf) so the order's
--     base prices stay stable even if the shared constant later changes. NULL
--     for the 4 known cemeteries (they read live from CEMETERY_DOOR_PRICING).
--   • tax_applied   — Step-6 NJ sales-tax (6.625%) toggle state.
--   • cc_fee_applied — Step-6 credit-card-fee (3%) toggle state.
--
-- Per-door price overrides ride inside the existing `doors` jsonb
-- (selectedItems entries become { key, price_override? }) — no column needed.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS cemetery_pricing_snapshot jsonb;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS tax_applied boolean NOT NULL DEFAULT false;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS cc_fee_applied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cemetery_orders.cemetery_pricing_snapshot IS
  'Frozen price-list payload for a custom (operator-added) cemetery, seeded from the Clover Leaf list at creation. NULL for the 4 known cemeteries, which read live from CEMETERY_DOOR_PRICING.';
COMMENT ON COLUMN cemetery_orders.tax_applied IS
  'Step-6 toggle: NJ sales tax (6.625%) added to the order total.';
COMMENT ON COLUMN cemetery_orders.cc_fee_applied IS
  'Step-6 toggle: credit-card fee (3%) added to the order total.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'cemetery_orders'
--      and column_name in ('cemetery_pricing_snapshot','tax_applied','cc_fee_applied')
--    order by column_name;
--   -- expect:
--   --   cc_fee_applied            | boolean | NO  | false
--   --   cemetery_pricing_snapshot | jsonb   | YES | (null)
--   --   tax_applied               | boolean | NO  | false
