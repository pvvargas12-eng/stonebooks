-- =============================================================================
-- 20260627_approval_links_share_url.sql — persist the approval link URL.
-- =============================================================================
-- Lets staff re-copy / re-send the SAME approval link anytime without
-- re-uploading a version. approve-create already computes the public URL (raw
-- token in the path); it now also stores it here. The raw token is in this URL,
-- so this DOES reverse the "raw token never stored" posture of 20260624 — ACCEPTED
-- because approval_links is staff-RLS-only (anon + partners cannot read it; the
-- approve-* Edge Functions use the service role). Staff are the ones who send the
-- link anyway. Token-hash lookup in approve-load/approve-submit is unchanged.
--
-- APPLY MANUALLY in Supabase Studio BEFORE deploying approve-create. Idempotent.
-- =============================================================================

alter table public.approval_links
  add column if not exists share_url text;

-- VERIFY:
--   select column_name from information_schema.columns
--     where table_name='approval_links' and column_name='share_url';  -- 1 row
