-- Terminology normalization: "Proof" → "Layout" in milestone labels.
-- Sprint J1-P1 follow-up. Diagnosed against the live milestone_templates
-- table on 2026-05-19.
--
-- LABEL-ONLY rename. Milestone keys are stable operational identifiers
-- (referenced by job_milestones.milestone_key, job_events, requires[],
-- cascades_to[]) and are intentionally left untouched. Templates affected:
--   new_stone   — keys: proof_created, proof_sent, proof_approved
--   inscription — keys: layout_created, proof_sent, proof_approved
--   bronze      — keys: bronze_proof_sent, bronze_proof_approved
--                 (bronze_layout_created already uses correct wording — not
--                  in scope here)
-- cleaning_repair has no proof/layout flow and is intentionally untouched.
-- new_stone.design_needed (decision milestone) is also intentionally left
-- alone in this patch — conceptual cleanup deferred.
--
-- Two-step transaction:
--   1. Rewrite the milestones[] JSONB array inside milestone_templates so
--      future jobs snapshot the new labels at creation time.
--   2. UPDATE the matching label fields on existing job_milestones rows so
--      every in-flight job shows consistent wording immediately.
--
-- Idempotent — re-runs are no-ops thanks to the `label <> desired` guards.
-- Run ONCE in Supabase Studio SQL Editor.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- PRE-STATE VERIFICATION — capture the labels we're about to change.
-- ─────────────────────────────────────────────────────────────────────

SELECT
  'BEFORE — milestone_templates' AS phase,
  t.job_type,
  t.version,
  m->>'key'   AS milestone_key,
  m->>'label' AS current_label
FROM milestone_templates t,
     jsonb_array_elements(t.template->'milestones') AS m
WHERE t.is_active = true
  AND m->>'key' IN (
    'proof_created', 'proof_sent', 'proof_approved',
    'layout_created',
    'bronze_proof_sent', 'bronze_proof_approved'
  )
ORDER BY t.job_type, m->>'key';

SELECT
  'BEFORE — job_milestones counts' AS phase,
  milestone_key,
  label AS current_label,
  COUNT(*) AS row_count
FROM job_milestones
WHERE milestone_key IN (
  'proof_created', 'proof_sent', 'proof_approved',
  'layout_created',
  'bronze_proof_sent', 'bronze_proof_approved'
)
GROUP BY milestone_key, label
ORDER BY milestone_key, label;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — Rewrite milestone_templates labels (keys untouched).
-- ─────────────────────────────────────────────────────────────────────
-- For each active template, rebuild template->'milestones' with the
-- targeted labels swapped via CASE. WITH ORDINALITY preserves array
-- order. ELSE ms keeps every non-targeted milestone byte-identical.
-- The EXISTS guard makes re-runs no-ops once labels match.

UPDATE milestone_templates t
SET template = jsonb_set(
  t.template,
  '{milestones}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN ms->>'key' = 'proof_created'
          THEN jsonb_set(ms, '{label}', '"Layout created"')
        WHEN ms->>'key' = 'proof_sent'
          THEN jsonb_set(ms, '{label}', '"Layout sent to customer"')
        WHEN ms->>'key' = 'proof_approved'
          THEN jsonb_set(ms, '{label}', '"Layout approved by customer"')
        WHEN ms->>'key' = 'layout_created'
          THEN jsonb_set(ms, '{label}', '"Layout created"')
        WHEN ms->>'key' = 'bronze_proof_sent'
          THEN jsonb_set(ms, '{label}', '"Bronze layout sent to customer"')
        WHEN ms->>'key' = 'bronze_proof_approved'
          THEN jsonb_set(ms, '{label}', '"Bronze layout approved by customer"')
        ELSE ms
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements(t.template->'milestones')
         WITH ORDINALITY AS arr(ms, ord)
  )
)
WHERE t.is_active = true
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(t.template->'milestones') AS m
    WHERE
      (m->>'key' = 'proof_created'         AND m->>'label' <> 'Layout created') OR
      (m->>'key' = 'proof_sent'            AND m->>'label' <> 'Layout sent to customer') OR
      (m->>'key' = 'proof_approved'        AND m->>'label' <> 'Layout approved by customer') OR
      (m->>'key' = 'layout_created'        AND m->>'label' <> 'Layout created') OR
      (m->>'key' = 'bronze_proof_sent'     AND m->>'label' <> 'Bronze layout sent to customer') OR
      (m->>'key' = 'bronze_proof_approved' AND m->>'label' <> 'Bronze layout approved by customer')
  );

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — Backfill labels on existing job_milestones rows.
-- ─────────────────────────────────────────────────────────────────────
-- `label` is a display-only column — no operational identifier. Updating
-- it does not affect milestone_key, requires[], cascades_to[], events,
-- or status state. Each statement is guarded so re-runs are no-ops.

UPDATE job_milestones
SET label = 'Layout created'
WHERE milestone_key IN ('proof_created', 'layout_created')
  AND label <> 'Layout created';

UPDATE job_milestones
SET label = 'Layout sent to customer'
WHERE milestone_key = 'proof_sent'
  AND label <> 'Layout sent to customer';

UPDATE job_milestones
SET label = 'Layout approved by customer'
WHERE milestone_key = 'proof_approved'
  AND label <> 'Layout approved by customer';

UPDATE job_milestones
SET label = 'Bronze layout sent to customer'
WHERE milestone_key = 'bronze_proof_sent'
  AND label <> 'Bronze layout sent to customer';

UPDATE job_milestones
SET label = 'Bronze layout approved by customer'
WHERE milestone_key = 'bronze_proof_approved'
  AND label <> 'Bronze layout approved by customer';

-- ─────────────────────────────────────────────────────────────────────
-- POST-STATE VERIFICATION — confirm the new labels.
-- ─────────────────────────────────────────────────────────────────────

SELECT
  'AFTER — milestone_templates' AS phase,
  t.job_type,
  t.version,
  m->>'key'   AS milestone_key,
  m->>'label' AS new_label
FROM milestone_templates t,
     jsonb_array_elements(t.template->'milestones') AS m
WHERE t.is_active = true
  AND m->>'key' IN (
    'proof_created', 'proof_sent', 'proof_approved',
    'layout_created',
    'bronze_proof_sent', 'bronze_proof_approved'
  )
ORDER BY t.job_type, m->>'key';

SELECT
  'AFTER — job_milestones counts' AS phase,
  milestone_key,
  label AS new_label,
  COUNT(*) AS row_count
FROM job_milestones
WHERE milestone_key IN (
  'proof_created', 'proof_sent', 'proof_approved',
  'layout_created',
  'bronze_proof_sent', 'bronze_proof_approved'
)
GROUP BY milestone_key, label
ORDER BY milestone_key, label;

COMMIT;
