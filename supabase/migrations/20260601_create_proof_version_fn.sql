-- =============================================================================
-- 20260601_create_proof_version_fn.sql
-- =============================================================================
-- Phase 5A.1 Stage 2 — version-create path.
--
-- create_proof_version(...) performs the full "add a new layout version"
-- transaction atomically, so the one-current-per-job invariant (enforced by
-- idx_proof_versions_one_current_per_job from 20260529_proof_versions.sql)
-- can never be tripped by an interleaved upload:
--   1. demote any existing is_current=true row for the job
--   2. compute next version_number = COALESCE(MAX(version_number),0)+1
--   3. insert the new row as is_current=true with that version_number
--   4. return the inserted row
--
-- A single SQL function body runs in one statement / one transaction, so the
-- demote + insert are atomic. The partial unique index is the backstop: if two
-- callers race, the second insert fails the unique constraint rather than
-- producing two current rows.
--
-- SECURITY DEFINER so the function owner's rights apply (the demote UPDATE +
-- insert run regardless of the caller's row-level reach); EXECUTE granted to
-- authenticated to match the table's RLS posture.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_proof_version(
  p_job_id            uuid,
  p_layout_image_url  text,
  p_metadata_snapshot jsonb,
  p_uploaded_by       text
)
RETURNS proof_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_version integer;
  v_row          proof_versions;
BEGIN
  -- 1. Demote the current row (if any) for this job.
  UPDATE proof_versions
     SET is_current = false
   WHERE job_id = p_job_id
     AND is_current = true;

  -- 2. Next version number for this job.
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM proof_versions
   WHERE job_id = p_job_id;

  -- 3. Insert the new current version.
  INSERT INTO proof_versions (
    job_id,
    version_number,
    layout_image_url,
    metadata_snapshot,
    uploaded_by,
    is_current
  )
  VALUES (
    p_job_id,
    v_next_version,
    p_layout_image_url,
    COALESCE(p_metadata_snapshot, '{}'::jsonb),
    p_uploaded_by,
    true
  )
  RETURNING * INTO v_row;

  -- 4. Return the inserted row.
  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION create_proof_version(uuid, text, jsonb, text) IS
  'Phase 5A.1 Stage 2 — atomically demote the current proof_versions row for a job, compute the next version_number, and insert a new is_current=true row. Returns the inserted row.';

GRANT EXECUTE ON FUNCTION create_proof_version(uuid, text, jsonb, text) TO authenticated;

-- ── Verify (paste in chat after running; replace :job_id) ───────────────────
-- WITH v1 AS (
--   SELECT * FROM create_proof_version(
--     '<REAL_JOB_ID>'::uuid, 'https://example/v1.jpg', '{}'::jsonb, 'verify-script')
-- ), v2 AS (
--   SELECT * FROM create_proof_version(
--     '<REAL_JOB_ID>'::uuid, 'https://example/v2.jpg', '{}'::jsonb, 'verify-script')
-- )
-- SELECT version_number, is_current
--   FROM proof_versions
--  WHERE job_id = '<REAL_JOB_ID>'::uuid
--  ORDER BY version_number;
-- Expected: v1 → is_current=false · v2 → is_current=true, version_number=2
