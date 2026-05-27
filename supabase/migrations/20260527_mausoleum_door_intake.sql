-- Mausoleum Door — intake column
-- =============================================================================
-- Adds a nullable `mausoleum_door_intake` JSONB column to orders, mirroring the
-- existing `mausoleum_intake` column. Holds the light door-job intake captured
-- by the sales wizard's MausoleumDoorStep (material, new-vs-existing door,
-- dimensions/finish, crypt/section/door position). Carved text rides on the
-- existing `inscription` column; a door photo is a deferred follow-up.
--
-- NULL for any order that isn't a MAUSOLEUM_DOOR service.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS mausoleum_door_intake jsonb;

COMMENT ON COLUMN orders.mausoleum_door_intake IS
  'Light intake for a mausoleum_door order (sales wizard MausoleumDoorStep): { material, doorStatus, dimensions, finish, cryptPosition }. NULL unless service_types includes MAUSOLEUM_DOOR. Parallels mausoleum_intake; carved text lives on the inscription column; door photo deferred.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'orders' and column_name = 'mausoleum_door_intake';
--   -- expect: mausoleum_door_intake | jsonb | YES
