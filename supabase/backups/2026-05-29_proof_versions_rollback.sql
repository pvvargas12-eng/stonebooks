-- =============================================================================
-- 2026-05-29_proof_versions_rollback.sql
-- =============================================================================
-- Rollback for 20260529_proof_versions.sql.
-- Paste into Studio SQL Editor in order if Migration M needs to be undone.
--
-- WARNING: Step 3 drops the proof_versions table and removes ALL rows.
-- Use only if Phase 5A.1 surface is being aborted entirely. For surgical
-- bugfixes, prefer ALTER over rollback.
--
-- Step 2 (bucket teardown) is gated behind a comment — leave commented to
-- preserve any uploaded layouts in storage. Uncomment only if rolling back
-- before any production uploads.
-- =============================================================================

-- ── 1. Drop storage policies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated deletes in orders-attachments-public"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated updates in orders-attachments-public"  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated uploads to orders-attachments-public"  ON storage.objects;

-- ── 2. (OPTIONAL) Drop public bucket + its files ──────────────────────────
-- Uncomment ONLY if rolling back before any production layouts uploaded.
-- DELETE FROM storage.objects WHERE bucket_id = 'orders-attachments-public';
-- DELETE FROM storage.buckets WHERE id = 'orders-attachments-public';

-- ── 3. Drop the table (CASCADE handles FK from any future child rows) ─────
DROP TABLE IF EXISTS proof_versions CASCADE;
