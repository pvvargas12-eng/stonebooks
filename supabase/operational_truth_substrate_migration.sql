-- Operational Truth Substrate — Phase 1 of the OD/OT foundation pass
-- ============================================================================
-- Adds three nullable columns to job_milestones so the system can express WHY
-- work cannot move, not just THAT it has not moved. All three columns are
-- additive and nullable; legacy rows render unchanged.
--
-- This single migration unlocks:
--   • Promise-risk honesty — Today can distinguish "stone in transit on
--     schedule" from "PO sent, supplier silent" from "stone never ordered."
--   • Structured blockers — `block_reason_code` replaces free-text guesswork
--     about why a job is stuck.
--   • External party identity as a noun — the milestone can name Coldspring,
--     Rock of Ages, Holy Cross — without a vendor entity yet.
--
-- Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: re-runs are safe (IF NOT EXISTS / DROP+ADD constraint patterns).
-- ============================================================================

ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS expected_resolution_at date;

ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS block_reason_code text;

ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS external_party_ref text;

-- Constraint: block_reason_code restricted to the structured enum.
-- The enum is small enough to lock down; if a new reason emerges, this
-- constraint can be dropped and recreated in a follow-up migration. We
-- deliberately allow NULL so milestones that are not currently blocked
-- carry no reason code.
ALTER TABLE job_milestones
  DROP CONSTRAINT IF EXISTS job_milestones_block_reason_code_check;

ALTER TABLE job_milestones
  ADD CONSTRAINT job_milestones_block_reason_code_check CHECK (
    block_reason_code IS NULL OR block_reason_code IN (
      'awaiting_decision',
      'awaiting_money',
      'awaiting_upstream',
      'vendor_silent',
      'customer_silent',
      'operator_paused'
    )
  );

COMMENT ON COLUMN job_milestones.expected_resolution_at IS
  'The external party''s promise back to us (supplier-quoted ETA, cemetery-quoted response date, customer-stated return date). Distinct from due_date — due_date is our internal target; this is what the other side committed to. When set, the engine can distinguish "in transit on schedule" from "promise broken." NULL when no external commitment has been captured.';

COMMENT ON COLUMN job_milestones.block_reason_code IS
  'Structured blocker enum. Required when milestone status is ''blocked'' so the system can name WHY, not just that something is stuck. Values: awaiting_decision (operator needs to choose), awaiting_money (money gates work), awaiting_upstream (prerequisite incomplete), vendor_silent (supplier owes a response), customer_silent (customer owes a response), operator_paused (deliberate hold). NULL when not blocked.';

COMMENT ON COLUMN job_milestones.external_party_ref IS
  'Free-form text identifier for the external party in play (supplier name like "Coldspring", cemetery contact name, PO/permit/confirmation reference). Lightweight predecessor to a full vendor entity. Surfaces inline in operational sentences ("expected from Coldspring on Tuesday"). NULL when no external party is named.';
