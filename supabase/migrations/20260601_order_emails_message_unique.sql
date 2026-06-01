-- =============================================================================
-- 20260601_order_emails_message_unique.sql
-- =============================================================================
-- Gmail integration Phase 4 — auto-association dedup guard.
--
-- gmail-sync UPSERTs inbound order_emails rows keyed on gmail_message_id, so a
-- re-sync of the same INBOX message updates the existing row instead of
-- inserting a duplicate. That upsert needs a UNIQUE target on gmail_message_id.
--
-- Postgres allows multiple NULLs in a UNIQUE index, so manual/legacy rows with
-- a null gmail_message_id are unaffected; only real Gmail message ids are
-- de-duplicated. Each Gmail message id is globally unique, so outbound rows
-- (Phase 2) and inbound rows never collide.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_emails_gmail_message_id
  ON order_emails (gmail_message_id);

-- ── Verify (paste in chat after running) ────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_order_emails_gmail_message_id') AS unique_msg_idx,
--   indexdef
-- FROM pg_indexes WHERE indexname='idx_order_emails_gmail_message_id';
-- Expected: unique_msg_idx = t · indexdef shows "CREATE UNIQUE INDEX … (gmail_message_id)"
