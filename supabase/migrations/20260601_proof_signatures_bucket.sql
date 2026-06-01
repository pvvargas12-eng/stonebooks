-- =============================================================================
-- 20260601_proof_signatures_bucket.sql
-- =============================================================================
-- Phase 5A.3 — PRIVATE storage bucket for proof approval signatures.
--
-- Signatures are PII (a person's handwritten mark), so unlike the public
-- orders-attachments-public bucket (layout previews), this bucket is private:
-- reads require a signed URL minted by an authenticated session. The approval
-- sheet renders the signature by resolving a short-lived signed URL at PDF time.
--
-- Path convention: signatures/<job_id>/<version_id>.png  (one signature per
-- proof version; upsert overwrites on re-sign).
--
-- RLS: authenticated full CRUD scoped to this bucket — matches the staff-only
-- posture of every other storage policy in the app. No anon access.
-- =============================================================================

-- ── 1. Private bucket ─────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('proof-signatures', 'proof-signatures', false)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Storage policies (authenticated INSERT / SELECT / UPDATE / DELETE) ──
CREATE POLICY "Authenticated insert proof-signatures"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'proof-signatures');

CREATE POLICY "Authenticated select proof-signatures"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'proof-signatures');

CREATE POLICY "Authenticated update proof-signatures"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'proof-signatures')
  WITH CHECK (bucket_id = 'proof-signatures');

CREATE POLICY "Authenticated delete proof-signatures"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'proof-signatures');

-- ── 3. Verify (paste in chat after running) ────────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM storage.buckets
--           WHERE id='proof-signatures' AND public=false)            AS private_bucket_exists,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='Authenticated insert proof-signatures') AS insert_policy,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='Authenticated select proof-signatures') AS select_policy,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='Authenticated update proof-signatures') AS update_policy,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='Authenticated delete proof-signatures') AS delete_policy;
-- Expected: all booleans = t
