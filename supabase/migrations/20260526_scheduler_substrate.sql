-- Scheduler Substrate
-- =============================================================================
-- Adds work batches as a first-class operational entity, plus promise
-- tracking and cemetery geocoding. Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: IF NOT EXISTS / DO-block guards on every step. Safe to re-run.
--
-- New entities:
--   • work_batches      — the unit of crew dispatch. Nine kinds. Each batch
--                          can be a field trip (with destination + stops) or
--                          a shop block (no destination).
--   • work_batch_jobs   — link table. Many jobs to one batch. Carries
--                          stop_order for field trips and a self-FK for
--                          carryover tracking when a job moves between
--                          batches across days.
--   • job_promises      — per-job, per-team-member promise log. Drives the
--                          🤡 treatment on Scheduler / Today / batch cards
--                          and the rolling kept-rate counters.
--   • cemetery geocoding — lat/lng columns + a region tag (manual today,
--                          a future iteration may auto-tag) on cemeteries.
--                          Fed by the one-shot geocode_cemeteries.mjs script.
-- =============================================================================

-- ── PART 1: work_batches ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_batches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  kind                    text NOT NULL,
  title                   text,
  scheduled_date          date,
  destination_cemetery_id uuid REFERENCES cemeteries(id),
  assigned_to             text,
  notes                   text,
  status                  text NOT NULL DEFAULT 'planned',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id)
);

-- Kind enum — nine batch kinds covering field trips and shop blocks.
-- Extensible by dropping + recreating this constraint.
ALTER TABLE work_batches DROP CONSTRAINT IF EXISTS work_batches_kind_check;
ALTER TABLE work_batches
  ADD CONSTRAINT work_batches_kind_check CHECK (
    kind IN (
      'inscription', 'blasting', 'setting', 'delivery',
      'acid_wash', 'repair', 'rub_grab',
      'foundation_trip', 'door_trip'
    )
  );

ALTER TABLE work_batches DROP CONSTRAINT IF EXISTS work_batches_status_check;
ALTER TABLE work_batches
  ADD CONSTRAINT work_batches_status_check CHECK (
    status IN ('planned', 'in_progress', 'running_late', 'completed', 'cancelled')
  );

CREATE INDEX IF NOT EXISTS idx_work_batches_scheduled_date ON work_batches(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_work_batches_kind            ON work_batches(kind);
CREATE INDEX IF NOT EXISTS idx_work_batches_status          ON work_batches(status);

COMMENT ON TABLE work_batches IS
  'A scheduled or planned unit of crew work. Field trips (inscription, setting, delivery, rub_grab, foundation_trip, door_trip) require a destination_cemetery_id. Shop blocks (blasting, acid_wash, repair) do not. scheduled_date is NULL while the batch sits in the build tray pre-scheduling.';

-- ── PART 2: work_batch_jobs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_batch_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES work_batches(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES jobs(id)         ON DELETE CASCADE,
  stop_order      int,
  completed_at    timestamptz,
  completed_by    text,
  carry_over_from uuid REFERENCES work_batch_jobs(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_batch_jobs_batch_id ON work_batch_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_work_batch_jobs_job_id   ON work_batch_jobs(job_id);

COMMENT ON COLUMN work_batch_jobs.stop_order IS
  'Ordering within a field trip (1, 2, 3 ...). NULL on non-trip batches (blasting / acid_wash / repair).';
COMMENT ON COLUMN work_batch_jobs.completed_at IS
  'Set when the crew marks this specific stop done. The batch as a whole moves to status=completed only when every linked stop is complete.';
COMMENT ON COLUMN work_batch_jobs.carry_over_from IS
  'Self-FK back to the previous work_batch_jobs row when the operator carried this stop forward from an unfinished prior-day batch. Lets the audit trail show "this stop slipped from Tuesday to Thursday."';

-- ── PART 3: job_promises ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_promises (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  promised_by     text NOT NULL,
  promised_date   date NOT NULL,
  kept            boolean,
  resolved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_job_promises_job_id        ON job_promises(job_id);
CREATE INDEX IF NOT EXISTS idx_job_promises_promised_by   ON job_promises(promised_by);
CREATE INDEX IF NOT EXISTS idx_job_promises_promised_date ON job_promises(promised_date);

COMMENT ON TABLE job_promises IS
  'One row per customer-facing promise made about a job (typically "we will install by date X" or "your stone will be done by date Y"). promised_by is a team-roster string (Cathy, Lonnie, etc.). kept is NULL while the promise is open; true when the job completed on or before promised_date; false when it completed late. Drives the 🤡 treatment everywhere and the per-team kept-rate rolling counters.';

-- ── PART 4: cemetery geocoding ─────────────────────────────────────────────

ALTER TABLE cemeteries
  ADD COLUMN IF NOT EXISTS geocoded_lat numeric(10, 7),
  ADD COLUMN IF NOT EXISTS geocoded_lng numeric(10, 7),
  ADD COLUMN IF NOT EXISTS region_tag   text,
  ADD COLUMN IF NOT EXISTS geocoded_at  timestamptz;

COMMENT ON COLUMN cemeteries.geocoded_lat IS
  'Latitude from one-time Nominatim geocoding (scripts/geocode_cemeteries.mjs). NULL until the script runs against a non-empty address. Used for haversine distance math in trip optimizer + dispatch mileage.';
COMMENT ON COLUMN cemeteries.geocoded_lng IS
  'Longitude. See geocoded_lat.';
COMMENT ON COLUMN cemeteries.region_tag IS
  'Operator-tagged region label (currently manual, NULL by default). A future iteration may auto-derive from geocoded_lat/lng + clustering.';
COMMENT ON COLUMN cemeteries.geocoded_at IS
  'Timestamp of the most recent geocoding pass. Set by the script after a successful Nominatim hit. NULL means the cemetery has not been geocoded yet.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify the new shape with:
--   \d work_batches
--   \d work_batch_jobs
--   \d job_promises
--   \d cemeteries
--
-- Then run scripts/geocode_cemeteries.mjs from a local node shell to populate
-- the lat/lng columns. The script obeys Nominatim's 1 req/sec policy.
