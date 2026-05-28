-- Migration L — Batch→Milestone Provenance
-- =============================================================================
-- Two text columns on work_batch_jobs that name the milestone keys at both
-- ends of a scheduled stop:
--
--   • source_milestone_key      — the milestone that SURFACED this job
--                                  into this batch kind (the routing key).
--                                  Set at batch creation time by the
--                                  scheduler's routing logic.
--   • completion_milestone_key  — the milestone the dispatch completion
--                                  should cascade to (the one that flips
--                                  status='done' + status_date=today when
--                                  the crew chief ticks the stop). Set at
--                                  batch creation time alongside the source.
--
-- WHY two columns: the two ends of a batch operation are often distinct.
-- The routing trigger (e.g. 'foundation_scheduled' surfaces the job into
-- a foundation_trip column) is a different milestone from the completion
-- satisfier (e.g. 'foundation_poured' flips done after the crew tops it
-- out on-site). Same for door_trip pickup runs: source='door_pickup_needed'
-- → completion='door_picked_up'. Modeling both lets markBatchJobComplete
-- cascade the right milestone deterministically, and lets analytics
-- trace WHICH milestone gate triggered each historical stop. For some
-- kinds the two will coincide today (e.g. blasting: production_started ↔
-- production_completed are distinct, but acid_wash currently has no
-- mapped pair); that's fine — the columns express intent independently.
--
-- WHY nullable: ad-hoc batches (site_visit, errand) have no underlying
-- milestone — they're free-form calendar entries. Legacy link rows
-- pre-Migration L also have no provenance (40 such rows existed in prod
-- when this migration was applied, all with NULL on both columns; the
-- Phase 2 cascade guards against NULL so they remain safe to operate on).
--
-- NO FK or value-CHECK on the column contents: milestone_key is free text
-- in job_milestones (no catalog table to FK against; the keys live inside
-- milestone_templates.template JSONB and are evolved at the application
-- layer). Introducing a value-CHECK here would require backfilling every
-- new milestone key into a SQL constraint at template-evolution time — a
-- brittle coupling. We do enforce a length+non-empty guard (below) to
-- catch empty-string writes that JS `IS NULL` checks would miss.
--
-- FORWARD COMPAT: if Migration M backfills + tightens these columns, the
-- correct NOT NULL pattern is a partial-NOT-NULL CHECK keyed on
-- work_batches.kind NOT IN ('site_visit', 'errand') rather than a
-- column-level NOT NULL. Ad-hoc kinds will never have these set; the
-- contract is "milestone-driven kinds must have both populated."
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT
-- EXISTS, DROP CONSTRAINT IF EXISTS before re-adding the CHECK. Safe to
-- re-run.
--
-- APPLIED to prod (ibekfollqnytxcuyekad) on 2026-05-28. Columns + CHECK
-- + comments verified green via the verify queries in the sprint Phase 1
-- gate. This file is the durable record.
-- =============================================================================

ALTER TABLE work_batch_jobs
  ADD COLUMN IF NOT EXISTS source_milestone_key     text,
  ADD COLUMN IF NOT EXISTS completion_milestone_key text;

-- Length + non-empty guard. Catches empty-string writes (which application
-- IS NULL checks would otherwise miss). 80 chars is comfortable headroom
-- vs the longest existing key (completion_photo_uploaded = 25 chars).
ALTER TABLE work_batch_jobs DROP CONSTRAINT IF EXISTS work_batch_jobs_milestone_keys_len;
ALTER TABLE work_batch_jobs
  ADD CONSTRAINT work_batch_jobs_milestone_keys_len CHECK (
    (source_milestone_key     IS NULL OR length(source_milestone_key)     BETWEEN 1 AND 80)
    AND
    (completion_milestone_key IS NULL OR length(completion_milestone_key) BETWEEN 1 AND 80)
  );

COMMENT ON COLUMN work_batch_jobs.source_milestone_key IS
  'The job_milestones.milestone_key whose actionable state surfaced this job into the batch kind that owns this link row. Set at batch creation by the scheduler''s routing logic (e.g. ''ready_to_install'' for a setting batch, ''door_pickup_needed'' for a door_trip pickup, ''foundation_scheduled'' for a pre-pour foundation_trip). NULL on ad-hoc zero-job kinds (site_visit, errand) and on legacy rows created before Migration L. No FK or value-CHECK — milestone_key is free text in job_milestones (keys live in milestone_templates.template JSONB); the application owns the validity contract. Once Migration M backfills, NOT NULL should be enforced via a partial CHECK keyed on work_batches.kind NOT IN (''site_visit'', ''errand''), not a column-level NOT NULL.';

COMMENT ON COLUMN work_batch_jobs.completion_milestone_key IS
  'The job_milestones.milestone_key that markBatchJobComplete cascades to status=''done'' + status_date=today when the crew chief ticks this stop on the dispatch sheet. Often distinct from source_milestone_key (e.g. door_trip pickup: source=door_pickup_needed → completion=door_picked_up; foundation_trip: source=foundation_scheduled → completion=foundation_poured); occasionally identical when no separate completion-satisfier exists yet in the template. Set at batch creation alongside source_milestone_key. NULL on ad-hoc kinds (no milestone to cascade) and on legacy rows. Closes the date-truth gap diagnosed in the 2026-05-28 audit: previously markBatchJobComplete only wrote completed_at on the link row and left the underlying milestone untouched, structurally guaranteeing the 2.7% status_date population in job_milestones.';
