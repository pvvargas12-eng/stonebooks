-- Orders — drop the orphaned mausoleum_door_intake column
-- =============================================================================
-- `orders.mausoleum_door_intake` (added in 20260527_mausoleum_door_intake.sql)
-- was the per-order door spec back when door work lived in the family-sales
-- `orders` flow. That model was reverted: door orders now live in their own
-- `cemetery_orders` table, with the door spec on cemetery_orders.doors. The
-- column has been unused since the revert (the regular orders flow no longer
-- reads or writes it), so it's dropped here.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: DROP COLUMN IF EXISTS.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE orders
  DROP COLUMN IF EXISTS mausoleum_door_intake;

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with (expect ZERO rows — column gone):
--   select column_name from information_schema.columns
--    where table_name = 'orders' and column_name = 'mausoleum_door_intake';
