-- Sprint M2 Phase 3 — Status snapshot for revert
-- Adds status_before_paid_in_full column. When an order's status flips to
-- paid_in_full because the sum of locked payments reaches the grand total,
-- the prior status is snapshotted here. If payments are later removed/voided
-- and the sum drops below the grand total, status reverts to this snapshot.
-- Null = no snapshot (default state for orders not currently paid_in_full,
-- or orders that were manually set to paid_in_full via OrderStatusChanger).
-- Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: re-runs are safe (IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS status_before_paid_in_full text;

COMMENT ON COLUMN orders.status_before_paid_in_full IS
  'Status snapshot taken when payments auto-flipped the order to paid_in_full. Used to revert status if locked payment sum later drops below grand total.';
