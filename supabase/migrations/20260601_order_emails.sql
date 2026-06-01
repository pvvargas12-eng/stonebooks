-- =============================================================================
-- 20260601_order_emails.sql
-- =============================================================================
-- Gmail integration Phase 2 — per-order email log. Outbound sends are written
-- by the gmail-send Edge Function (service role); inbound replies will be
-- written by the Phase 3 inbox sync. The gmail_thread_id + the
-- X-Stonebooks-Order-Id header on outbound mail are what let inbound replies
-- auto-attach to the right order later.
--
-- RLS: authenticated may READ (staff see an order's email thread); there are NO
-- write policies, so INSERT/UPDATE/DELETE happen only via the service-role
-- Edge Function. Tokens are never involved here — this table holds message
-- metadata only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_emails (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  order_id            uuid        REFERENCES orders(id) ON DELETE SET NULL,
  customer_id         uuid,
  gmail_message_id    text,
  gmail_thread_id     text,
  direction           text,       -- 'outbound' | 'inbound'
  from_email          text,
  to_email            text,
  subject             text,
  snippet             text,
  body                text,
  sent_at             timestamptz,
  association_method  text,       -- 'header' | 'thread' | 'manual' …
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_emails IS
  'Gmail integration — per-order email log (message metadata). Read: authenticated; write: service-role Edge Function only.';

-- Per-order thread, newest-first.
CREATE INDEX IF NOT EXISTS idx_order_emails_order_sent
  ON order_emails (order_id, sent_at DESC);

ALTER TABLE order_emails ENABLE ROW LEVEL SECURITY;

-- Read-only for authenticated staff. No write policy ⇒ writes go through the
-- service role (Edge Function) only.
CREATE POLICY order_emails_authenticated_read
  ON order_emails
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Verify (paste in chat after running) ────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.tables
--           WHERE table_name='order_emails')                       AS table_exists,
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_order_emails_order_sent')          AS list_idx,
--   (SELECT relrowsecurity FROM pg_class
--      WHERE oid='public.order_emails'::regclass)                  AS rls_enabled,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='order_emails_authenticated_read')     AS read_policy,
--   (SELECT COUNT(*) FROM pg_policies
--      WHERE tablename='order_emails')                             AS policy_count,
--   (SELECT COUNT(*) FROM order_emails)                            AS row_count;
-- Expected: table_exists=t · list_idx=t · rls_enabled=t · read_policy=t ·
--           policy_count=1 (read only; writes are service-role) · row_count=0
