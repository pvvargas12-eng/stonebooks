-- =============================================================================
-- 20260529_proof_versions.sql
-- =============================================================================
-- Phase 5A.1 Migration M — proof_versions table + public storage bucket.
--
-- Tracks each uploaded design-layout version per job, with a frozen metadata
-- snapshot (the values that were "true at upload time" — historical truth)
-- and an editable overrides JSONB so the designer can inline-edit packet
-- metadata in the composer without mutating the snapshot. Display rule:
--   display_value = metadata_overrides[field] ?? metadata_snapshot[field]
--
-- Lifecycle: exactly ONE row per job has is_current=true. When a new layout
-- is uploaded, the existing current row is demoted to is_current=false
-- BEFORE the new row inserts. A partial unique index enforces the
-- one-current-per-job invariant at the DB level so a race condition can't
-- produce two current rows.
--
-- Phase 5A.2 (email sending) and 5A.3 (e-signature + paper-scan upload)
-- will populate sent_at / approved_at / approved_by_name / signature_method
-- / signature_url. All nullable for now.
--
-- Storage path convention:
--   orders-attachments-public/<order_id>/layouts/v<N>_<ts>.<ext>
-- New public bucket created at the bottom of this migration — keeps the
-- mental model "this whole bucket is public" cleaner than a prefix-based
-- policy on the existing private orders-attachments bucket.
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proof_versions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  job_id              uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version_number      integer     NOT NULL,

  -- Public-bucket URL of the uploaded layout image (JPG or PNG only,
  -- enforced client-side at upload). Public bucket = jsPDF's urlToDataURL()
  -- helper can fetch the URL without signed-URL gymnastics.
  layout_image_url    text        NOT NULL,

  -- Audit
  uploaded_by         text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),

  -- Frozen "at upload time" values used by the packet composer + PDF
  -- generator. Reproducible historical packets — even if order data changes
  -- later, V1's snapshot still reflects what was true on the day V1 was
  -- uploaded. Free-form JSONB so the app can grow keys without migrations.
  -- Expected keys (per Phase 5A.1 spec):
  --   order_number, design_date, balance, die_size, base_size,
  --   stone_color, cemetery_name, family_name, deceased_names (array)
  metadata_snapshot   jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Inline-edit overrides written by the designer in the packet composer
  -- modal. Empty {} = no overrides, snapshot used verbatim. Per-field reset
  -- in the UI removes a key from this JSONB. Display rule:
  --   COALESCE(metadata_overrides->>'field', metadata_snapshot->>'field')
  -- Snapshot is never mutated after INSERT.
  metadata_overrides  jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Approval state — nullable until Phase 5A.2/3 wires send + signature.
  sent_at             timestamptz,
  approved_at         timestamptz,
  approved_by_name    text,
  signature_method    text        CHECK (
                                    signature_method IS NULL
                                    OR signature_method IN ('e_signature', 'paper_scan')
                                  ),
  signature_url       text,

  -- Lifecycle flag — exactly one row per job has true. New upload demotes
  -- the prior current row before insert (Stage 2 wiring). Partial unique
  -- index below enforces the invariant at the DB level.
  is_current          boolean     NOT NULL DEFAULT true,

  notes               text,

  UNIQUE (job_id, version_number)
);

COMMENT ON TABLE proof_versions IS
  'Phase 5A.1 — Approval-packet version history per job. Each row is one uploaded layout image + a frozen metadata snapshot + editable overrides. Lifecycle: is_current=true on the latest version only (enforced by partial unique index).';

-- ── 2. Indexes ────────────────────────────────────────────────────────────
-- Version-stack list (DESC newest first), the primary list query.
CREATE INDEX IF NOT EXISTS idx_proof_versions_job_version
  ON proof_versions (job_id, version_number DESC);

-- "What's current" lookup — partial index doubles as a unique constraint
-- enforcing the one-current-per-job lifecycle rule. A racing upload that
-- forgets to demote the prior current row will hit a unique violation
-- instead of silently producing two current rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_versions_one_current_per_job
  ON proof_versions (job_id) WHERE is_current = true;

-- Approval-state lookups (Phase 5A.2/3 ready).
CREATE INDEX IF NOT EXISTS idx_proof_versions_approval_state
  ON proof_versions (job_id, approved_at DESC NULLS LAST);

-- ── 3. RLS — matches existing convention ──────────────────────────────────
-- Same pattern as financial_records / job_cost_estimates / cemetery_orders:
-- authenticated-only, no tenant filter in the policy itself. Single-tenant
-- Shevchenko deployment; tenant_id default handles partitioning.
ALTER TABLE proof_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY proof_versions_authenticated_all
  ON proof_versions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 4. Public storage bucket for layout images ────────────────────────────
-- New bucket (vs prefix-based policy on the existing private
-- orders-attachments bucket) — cleaner mental model in Supabase's policy
-- system: "this whole bucket is public-read" vs juggling a prefix predicate
-- where any future folder added at the wrong prefix accidentally inherits
-- public. Layout images are non-sensitive design previews; nothing personal
-- to gate.
INSERT INTO storage.buckets (id, name, public)
VALUES ('orders-attachments-public', 'orders-attachments-public', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — public-bucket SELECTs are auto-allowed by Supabase, but
-- INSERT/UPDATE/DELETE need explicit policies. Authenticated-only writes
-- match the rest of the app's storage posture.
CREATE POLICY "Authenticated uploads to orders-attachments-public"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'orders-attachments-public');

CREATE POLICY "Authenticated updates in orders-attachments-public"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'orders-attachments-public')
  WITH CHECK (bucket_id = 'orders-attachments-public');

CREATE POLICY "Authenticated deletes in orders-attachments-public"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'orders-attachments-public');

-- ── 5. Verify (paste in chat after running) ───────────────────────────────
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.tables
--           WHERE table_name='proof_versions')                     AS table_exists,
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_proof_versions_one_current_per_job') AS unique_current_idx,
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_proof_versions_job_version')      AS list_idx,
--   EXISTS (SELECT 1 FROM pg_indexes
--           WHERE indexname='idx_proof_versions_approval_state')   AS approval_idx,
--   EXISTS (SELECT 1 FROM pg_policies
--           WHERE policyname='proof_versions_authenticated_all')   AS rls_policy_exists,
--   EXISTS (SELECT 1 FROM storage.buckets
--           WHERE id='orders-attachments-public')                  AS public_bucket_exists,
--   (SELECT COUNT(*) FROM proof_versions)                          AS row_count;
-- Expected: all booleans = t · row_count = 0
