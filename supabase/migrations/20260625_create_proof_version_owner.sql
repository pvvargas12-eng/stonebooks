-- =============================================================================
-- 20260625_create_proof_version_owner.sql
-- =============================================================================
-- Owner-aware create_proof_version (Option A): a proof belongs to EITHER a job
-- OR an order (lead). Branches the demote / MAX(version) / insert on whichever
-- owner is passed, and enforces exactly-one-owner. The per-owner partial unique
-- indexes (idx_pv_one_current_per_*) are the atomic backstop, exactly as the
-- per-job index was for the original RPC.
--
-- RUN ORDER: AFTER 20260625_proof_versions_order_scope.sql (needs order_id).
-- =============================================================================

-- Drop the old job-only signature so the new one isn't an ambiguous overload.
DROP FUNCTION IF EXISTS create_proof_version(uuid, text, jsonb, text);

CREATE OR REPLACE FUNCTION create_proof_version(
  p_layout_image_url  text,
  p_metadata_snapshot jsonb DEFAULT '{}'::jsonb,
  p_uploaded_by       text  DEFAULT NULL,
  p_job_id            uuid  DEFAULT NULL,
  p_order_id          uuid  DEFAULT NULL
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
  -- Exactly one owner (defense-in-depth alongside proof_versions_one_owner).
  IF (p_job_id IS NOT NULL) = (p_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'create_proof_version: exactly one of p_job_id / p_order_id must be set';
  END IF;

  -- 1. Demote the current row for THIS owner.
  UPDATE proof_versions SET is_current = false
   WHERE is_current = true
     AND ( (p_job_id   IS NOT NULL AND job_id   = p_job_id)
        OR (p_order_id IS NOT NULL AND order_id = p_order_id) );

  -- 2. Next version number for THIS owner.
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM proof_versions
   WHERE ( (p_job_id   IS NOT NULL AND job_id   = p_job_id)
        OR (p_order_id IS NOT NULL AND order_id = p_order_id) );

  -- 3. Insert the new current version (the unused owner stays NULL → XOR holds).
  INSERT INTO proof_versions (
    job_id, order_id, version_number, layout_image_url,
    metadata_snapshot, uploaded_by, is_current
  ) VALUES (
    p_job_id, p_order_id, v_next_version, p_layout_image_url,
    COALESCE(p_metadata_snapshot, '{}'::jsonb), p_uploaded_by, true
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION create_proof_version(text, jsonb, text, uuid, uuid) IS
  'Owner-aware (Option A): atomically demote the current proof_versions row for the given owner (job_id XOR order_id), compute next version_number for that owner, and insert a new is_current=true row. Returns the inserted row.';

GRANT EXECUTE ON FUNCTION create_proof_version(text, jsonb, text, uuid, uuid) TO authenticated;

-- ── Verify (paste in chat after running; replace :order_id with a REAL lead) ──
-- WITH v1 AS (SELECT * FROM create_proof_version('https://example/v1.jpg', '{}'::jsonb, 'verify', NULL, '<ORDER_ID>'::uuid)),
--      v2 AS (SELECT * FROM create_proof_version('https://example/v2.jpg', '{}'::jsonb, 'verify', NULL, '<ORDER_ID>'::uuid))
-- SELECT version_number, is_current, order_id, job_id
--   FROM proof_versions WHERE order_id = '<ORDER_ID>'::uuid ORDER BY version_number;
-- Expected: v1 → is_current=false · v2 → is_current=true, version_number=2, job_id NULL
