-- Sprint 3r.2 — Multi-design support on orders.
-- Adds a JSONB `designs` array column. designs[0] is the PRIMARY
-- (the design the carver replicates); designs[1..5] are ALTERNATES
-- (inspiration / reference only). Max 6 enforced in the app layer.
--
-- Each element is { id: <monument id>, snapshot: <full monument record JSONB> }.
--
-- The pre-existing design_id and design_snapshot columns are kept for
-- backward read-compatibility — toOrderRow continues to write designs[0]
-- into them so old code paths (or any external readers) still see the
-- primary design. They are no longer the source of truth.
--
-- Run this migration ONCE against the Shevchenko Supabase project.
-- Idempotent: re-runs are safe (IF NOT EXISTS + conditional backfill).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS designs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: any existing order with a single design (design_id set) gets
-- promoted into a one-element designs array. Skip rows that already have
-- a populated designs column (re-run safety).
UPDATE orders
SET designs = jsonb_build_array(
  jsonb_build_object(
    'id',       design_id,
    'snapshot', design_snapshot
  )
)
WHERE design_id IS NOT NULL
  AND (designs IS NULL OR designs = '[]'::jsonb);

COMMENT ON COLUMN orders.designs IS
  'Sprint 3r.2 — array of {id, snapshot} for selected monument designs. designs[0] is the primary (the design the carver replicates); designs[1..5] are alternates. Max 6 enforced in the app layer. design_id and design_snapshot are kept for backward read-compatibility (mirror of designs[0]).';
