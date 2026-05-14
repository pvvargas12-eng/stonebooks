-- Sprint M2 Phase 1 — Payments array
-- Adds payments[] JSONB column on orders. Each entry has shape:
--   { id, amount, method, ref, receivedAt, createdAt, createdBy, note, voided, voidedReason, voidedAt, voidedBy }
-- For Phase 1, this column shadows the legacy deposit_*/balance_* columns:
--   - On write, the app mirrors the first non-voided entry to deposit_* and the second to balance_*
--   - On read, if payments is empty, the app synthesizes entries from the legacy columns
--   - This keeps the existing UI working unchanged in Phase 1
-- Phase 2 will rewrite the UI to read directly from payments[]
-- Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: re-runs are safe (IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN orders.payments IS
  'Multi-payment array. Phase 1 (Sprint M2): shadows legacy deposit_*/balance_* columns via app-side mirror-write. Phase 2+ will make this the primary source.';
