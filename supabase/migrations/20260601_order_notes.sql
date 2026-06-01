-- =============================================================================
-- 20260601_order_notes.sql
-- =============================================================================
-- Order Detail View — per-order note log. Each row is one staff note on an
-- order: free-text body + author display name + created timestamp. Newest-first
-- in the UI; append-only (no edit/delete surface this commit).
--
-- RLS: authenticated full CRUD (same staff-only posture as every other table).
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  order_id    uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  body        text        NOT NULL,
  author      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_notes IS
  'Order Detail View — per-order staff note log (append-only). body + author + created_at.';

-- Newest-first list query per order.
CREATE INDEX IF NOT EXISTS idx_order_notes_order_created
  ON order_notes (order_id, created_at DESC);

ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_notes_authenticated_all
  ON order_notes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Verify (paste in chat after running) ────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.tables
--           WHERE table_name='order_notes')                       AS table_exists,
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_order_notes_order_created')       AS list_idx,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='order_notes_authenticated_all')      AS rls_policy,
--   (SELECT COUNT(*) FROM order_notes)                             AS row_count;
-- Expected: all booleans = t · row_count = 0
