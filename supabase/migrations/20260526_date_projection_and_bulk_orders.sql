-- Date Projection + Bulk Supplier Orders
-- =============================================================================
-- Two coupled substrate additions. Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DO-block
-- guards on the foreign key. Safe to re-run.
--
-- Part 1 — Date projection
-- ---------------------------------------------------------------------------
-- Adds three new milestone columns so the system can express its honest
-- estimate of when each stage will finish, alongside the customer-facing
-- promise. `actual_completion_at` is NOT added — the existing `status_date`
-- column already captures the completion timestamp when status='done', and
-- the JS projection engine reads it that way. (Compromise: status_date also
-- gets touched when status moves through in_progress, so projection treats it
-- as the completion date only when status='done'. Future iteration may add a
-- dedicated completed_at column if the in_progress dual-use becomes a problem.)
--
-- Part 2 — Bulk supplier orders
-- ---------------------------------------------------------------------------
-- New `bulk_orders` table groups multiple milestones (stones, photos, etching,
-- bronze) into a single PO to a supplier. Each milestone optionally links via
-- `bulk_order_id`. When the bulk order is received, every linked milestone
-- cascades to received state with status_date set.
--
-- The bulk order's `supplier_eta` feeds back into the date projection so
-- stone-stage projections reflect the actual supplier-quoted arrival instead
-- of the generic 30-day default in PACING_DAYS.
-- =============================================================================

-- ── PART 1: Milestone projection columns ───────────────────────────────────

-- The customer-facing promise. Set at job creation from the contract's
-- target_completion_date or equivalent; NEVER auto-moves. Editable only via
-- an explicit "Change customer promise" action (out of scope for this
-- migration — column exists, callers respect any value already there).
ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS contract_due_at date;

-- The system's honest current estimate. Recalculated whenever upstream stages
-- slip or accelerate. Persisted ONLY when an operator manually overrides it
-- (combined with projected_completion_at_user_set=true below); otherwise
-- derived live by projectJobDates() and never written back. Storing the
-- user-set value lets future loads honor the operator's judgment without
-- requiring a separate annotation column.
ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS projected_completion_at date;

-- When true, the operator has manually set projected_completion_at and
-- projection MUST NOT overwrite it on recompute. Downstream milestones still
-- re-project from this value, but the sticky value itself is fixed.
ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS projected_completion_at_user_set boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN job_milestones.contract_due_at IS
  'The customer-facing promise. Set at job creation from the contract; never auto-moves. Distinct from projected_completion_at (system''s live estimate) and from due_date (operator''s internal target).';
COMMENT ON COLUMN job_milestones.projected_completion_at IS
  'System''s honest projection. Persisted only when an operator manually overrides it (see projected_completion_at_user_set); otherwise derived live by projectJobDates() at read time.';
COMMENT ON COLUMN job_milestones.projected_completion_at_user_set IS
  'When true, projected_completion_at was set by an operator and projection must not overwrite it on recompute. Downstream milestones still propagate from the manual value.';

-- ── PART 2: Bulk supplier orders ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bulk_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  kind            text NOT NULL,
  supplier_name   text NOT NULL,
  po_number       text,
  po_uploaded_at  timestamptz,
  po_file_url     text,
  placed_at       date NOT NULL DEFAULT current_date,
  supplier_eta    date,
  received_at     date,
  received_by     uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Kind enum — extensible by dropping + recreating this constraint. Kept small
-- on purpose; new kinds need explicit operator support in the UI anyway.
ALTER TABLE bulk_orders
  DROP CONSTRAINT IF EXISTS bulk_orders_kind_check;
ALTER TABLE bulk_orders
  ADD CONSTRAINT bulk_orders_kind_check CHECK (
    kind IN ('stone', 'photo', 'etching', 'bronze')
  );

COMMENT ON TABLE bulk_orders IS
  'A single PO to a supplier covering one or more job milestones. Milestones link in via job_milestones.bulk_order_id. When received_at is set, every linked milestone cascades to received state.';

-- ── Milestone → bulk_order link ────────────────────────────────────────────

ALTER TABLE job_milestones
  ADD COLUMN IF NOT EXISTS bulk_order_id uuid;

-- Foreign key, guarded so re-runs don't fail. ON DELETE SET NULL keeps the
-- milestone alive if the bulk_order is later deleted; the projection just
-- falls back to the default pacing when the link disappears.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_milestones_bulk_order_id_fkey'
  ) THEN
    ALTER TABLE job_milestones
      ADD CONSTRAINT job_milestones_bulk_order_id_fkey
      FOREIGN KEY (bulk_order_id) REFERENCES bulk_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bulk_orders_received_at_idx
  ON bulk_orders (received_at);

CREATE INDEX IF NOT EXISTS bulk_orders_kind_idx
  ON bulk_orders (kind);

CREATE INDEX IF NOT EXISTS job_milestones_bulk_order_id_idx
  ON job_milestones (bulk_order_id);

COMMENT ON COLUMN job_milestones.bulk_order_id IS
  'Optional link to a bulk_orders row. Multiple milestones can share one bulk_order. When the bulk_order is marked received, every linked milestone cascades to received state with status_date set.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify the new shape with:
--   \d job_milestones
--   \d bulk_orders
