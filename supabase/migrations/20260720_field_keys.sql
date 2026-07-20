-- =============================================================================
-- 20260720_field_keys.sql — private per-person field links (FIELD-6)
-- =============================================================================
-- Paul: "a private link that only I have for my owner account, then individual
-- links for all of my coworkers — in Settings I have a link for each person."
-- employees.field_key holds a long random token; the link is
--   https://<app>/field#k=<field_key>
-- Opening it redeems the key at /api/field/redeem (service role validates,
-- mints a real Supabase session for the shared staff account via
-- admin.generateLink + verifyOtp) and pins the phone to that person.
-- Regenerating the key in Settings > Staff revokes the old link.
-- The key is a credential — generated client-side with crypto.getRandomValues,
-- 32+ chars, unguessable, unique.
-- Idempotent — safe to re-run.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_key text;

CREATE UNIQUE INDEX IF NOT EXISTS employees_field_key_idx
  ON employees (field_key) WHERE field_key IS NOT NULL;

-- ── VERIFY ──
-- select column_name from information_schema.columns
--   where table_name='employees' and column_name='field_key';
