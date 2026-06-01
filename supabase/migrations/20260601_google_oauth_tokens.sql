-- =============================================================================
-- 20260601_google_oauth_tokens.sql
-- =============================================================================
-- Gmail integration Phase 1 (Connect only). Server-only OAuth token store for
-- connected @shevcomonuments.com mailboxes. The Edge Function (service role)
-- is the ONLY reader/writer — tokens never touch the browser.
--
-- SECURITY: RLS is enabled with NO policies → both anon and authenticated
-- clients get zero access (default-deny). The service-role key bypasses RLS, so
-- only the gmail-oauth-callback Edge Function can read/write this table.
--
-- Phase 1 stores minimal-scope tokens (openid email profile). Phase 2 adds
-- gmail.send and Phase 3 gmail.readonly via one-click re-consent (the scopes
-- column records what was actually granted).
-- =============================================================================

CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  connected_email text        NOT NULL,
  refresh_token   text,
  access_token    text,
  token_expiry    timestamptz,
  scopes          text,
  connected_by    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One token row per mailbox — lets the Edge Function upsert on re-consent.
  UNIQUE (connected_email)
);

COMMENT ON TABLE google_oauth_tokens IS
  'Gmail integration — server-only OAuth tokens per connected mailbox. RLS deny-all; only the service-role Edge Function reads/writes.';

-- RLS enabled, NO policies = deny all client (anon + authenticated) access.
-- Service role bypasses RLS for the Edge Function.
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- ── Verify (paste in chat after running) ────────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.tables
--           WHERE table_name='google_oauth_tokens')                 AS table_exists,
--   (SELECT relrowsecurity FROM pg_class
--      WHERE oid='public.google_oauth_tokens'::regclass)            AS rls_enabled,
--   (SELECT COUNT(*) FROM pg_policies
--      WHERE tablename='google_oauth_tokens')                       AS policy_count,
--   EXISTS (SELECT 1 FROM pg_constraint
--           WHERE conname='google_oauth_tokens_connected_email_key') AS unique_email;
-- Expected: table_exists=t · rls_enabled=t · policy_count=0 · unique_email=t
-- (policy_count = 0 with rls_enabled = t IS the deny-all client posture.)
