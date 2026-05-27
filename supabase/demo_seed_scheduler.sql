-- =============================================================================
-- supabase/demo_seed_scheduler.sql
-- Scheduler-layer demo data: work_batches, work_batch_jobs, job_promises,
-- plus cemetery geocoding. Layers ON TOP OF the 25 jobs created by
-- supabase/demo_seed_25_jobs.sql — it references those jobs by their
-- deterministic UUIDs and creates NO new jobs/orders/customers.
-- =============================================================================
--
-- PRECONDITION: supabase/demo_seed_25_jobs.sql must already be applied (the 25
-- DEMO- jobs d0000000-…-0001..0025 and the 3 ZZ_DEMO_ cemeteries must exist).
-- Run supabase/demo_cleanup.sql first if a prior scheduler-demo state exists.
--
-- SCHEMA PREREQUISITES — this seed assumes all FIVE scheduler migrations are
-- applied (verified live in prod 2026-05-27):
--   • supabase/migrations/20260526_date_projection_and_bulk_orders.sql
--   • supabase/migrations/20260526_scheduler_substrate.sql   (work_batches,
--       work_batch_jobs, job_promises, cemeteries geocoding columns)
--   • supabase/migrations/20260527_custom_event_batch_kinds.sql  (site_visit,
--       errand kinds)
--   • supabase/migrations/20260527_scheduler_rls.sql
--   • supabase/migrations/20260527_work_batches_am_pm.sql    (am_pm column —
--       REQUIRED; this seed writes 'am'/'pm' on scheduled batches)
--
-- Tenant: Shevchenko default (a1b2c3d4-e5f6-7890-abcd-ef0123456789).
--
-- DEMO PREFIX DISCIPLINE (cleanup safety — real data is mixed in):
--   • New cemeteries:  name starts 'ZZ_DEMO_'.
--   • Every work_batch: title starts 'ZZ_DEMO_'  ← the cleanup identifier.
--   • work_batch_jobs / job_promises have no name field; cleanup identifies
--     them by FK to demo batches / demo jobs.
--   • assigned_to / promised_by hold plain crew names (Lonnie/Cathy/Mike) and
--     are NEVER used as cleanup identifiers — by design.
--
-- DETERMINISTIC UUID RANGES (match Tuesday's seed convention):
--   cemeteries (new)   b0000000-…-0004 .. 0007
--   work_batches       e0000000-…-0001 .. 0025
--   work_batch_jobs    e1000000-…-0001 .. 0042
--   job_promises       e2000000-…-0001 .. 0008
--   (existing demo jobs referenced: d0000000-…-0001 .. 0025)
--
-- DATE MODEL: all dates are current_date-relative so the fixture stays a
-- "next ~2 weeks / recent past" calendar whenever it runs. The weekday
-- clustering (heavy/single/empty days) was designed for a run on/near
-- Wed 2026-05-27; the inline (~M/D) comments show the intended calendar date.
--
-- IDEMPOTENCY: deterministic UUIDs + ON CONFLICT (id) DO NOTHING on every
-- INSERT; the cemetery geocoding UPDATE is deterministic. Safe to re-run.
--
-- =============================================================================
-- WHAT THIS SEED COVERS (against the drag-to-calendar fixture bar)
--   • 25 work_batches: 10 tray (scheduled_date NULL) + 12 scheduled across the
--     next 2 weeks + 3 past. All 11 kinds represented. All 5 status values.
--   • AM/PM: of the 12 scheduled — 5 am / 5 pm / 2 NULL (all-day) for coverage.
--   • Clustering: a heavy day (4 batches), single-batch days, and empty days.
--   • Cemeteries geocoded: a tight Perth Amboy/Woodbridge cluster + Edison mid
--     + two far outliers (Trenton ~30mi, Toms River ~40mi) for trip-optimizer.
--   • ~42 work_batch_jobs stop links (stop_order on trips, NULL on shop blocks,
--     0 on event batches); 2 carry_over_from links for the slip audit trail.
--   • 8 job_promises: 5 overdue (kept NULL, past) + 2 kept + 1 upcoming.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — Cemeteries: geocode the existing 3 + add 4 (geographic spread)
-- ─────────────────────────────────────────────────────────────────────────────
-- Trip-optimizer reads geocoded_lat/lng (haversine). Cluster = Perth Amboy /
-- Woodbridge (within ~5mi); outliers = Trenton (~30mi) and Toms River (~40mi).

UPDATE cemeteries SET
  geocoded_lat = 40.5068, geocoded_lng = -74.2654,
  region_tag = 'perth_amboy', geocoded_at = now()
WHERE id = 'b0000000-0000-4000-8000-000000000001';  -- ZZ_DEMO_Hillside

UPDATE cemeteries SET
  geocoded_lat = 40.5132, geocoded_lng = -74.2789,
  region_tag = 'perth_amboy', geocoded_at = now()
WHERE id = 'b0000000-0000-4000-8000-000000000002';  -- ZZ_DEMO_St Mary's

UPDATE cemeteries SET
  geocoded_lat = 40.5576, geocoded_lng = -74.2846,
  region_tag = 'woodbridge', geocoded_at = now()
WHERE id = 'b0000000-0000-4000-8000-000000000003';  -- ZZ_DEMO_Resurrection

INSERT INTO cemeteries (id, tenant_id, name, geocoded_lat, geocoded_lng, region_tag, geocoded_at, created_at)
VALUES
  ('b0000000-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Holy Cross Cemetery',      40.5490, -74.2746, 'woodbridge', now(), now()),
  ('b0000000-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Greenwood Memorial Park',  40.5187, -74.4121, 'edison',     now(), now()),
  ('b0000000-0000-4000-8000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Riverside Memorial',       40.2206, -74.7597, 'trenton',    now(), now()),
  ('b0000000-0000-4000-8000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Ocean View Cemetery',      39.9537, -74.1979, 'toms_river', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — Work batches (25)
-- ─────────────────────────────────────────────────────────────────────────────
-- Field-trip kinds carry a destination_cemetery_id; shop blocks (blasting,
-- acid_wash, repair) and the errand event do not. scheduled_date NULL = build
-- tray. am_pm: 'am' | 'pm' | NULL (all-day / unslotted).

INSERT INTO work_batches (
  id, tenant_id, kind, title, scheduled_date, destination_cemetery_id,
  assigned_to, notes, status, am_pm, created_at, updated_at
) VALUES
  -- ── TRAY (10): scheduled_date NULL, am_pm NULL — drag source ──────────────
  ('e0000000-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'foundation_trip', 'ZZ_DEMO_ Foundation pour — Hillside',          NULL, 'b0000000-0000-4000-8000-000000000001', 'Lonnie', 'ZZ_DEMO_ tray: cluster foundation run',        'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting run — Resurrection',          NULL, 'b0000000-0000-4000-8000-000000000003', 'Mike',   'ZZ_DEMO_ tray: stones ready to set',           'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'delivery',        'ZZ_DEMO_ Delivery — Greenwood (Edison)',       NULL, 'b0000000-0000-4000-8000-000000000005', 'Lonnie', 'ZZ_DEMO_ tray: mid-distance delivery',         'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'inscription',     'ZZ_DEMO_ Onsite inscription — St Mary''s',     NULL, 'b0000000-0000-4000-8000-000000000002', 'Cathy',  'ZZ_DEMO_ tray: in-place date carving',         'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'rub_grab',        'ZZ_DEMO_ Rubbing/measure — Holy Cross',        NULL, 'b0000000-0000-4000-8000-000000000004', 'Mike',   'ZZ_DEMO_ tray: measurements + rubbings',       'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'door_trip',       'ZZ_DEMO_ Door/foundation — Riverside (Trenton)',NULL,'b0000000-0000-4000-8000-000000000006', 'Lonnie', 'ZZ_DEMO_ tray: far outlier door trip',         'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'acid_wash',       'ZZ_DEMO_ Acid wash batch (shop)',              NULL, NULL,                                   'Mike',   'ZZ_DEMO_ tray: shop block, no destination',    'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000008', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'blasting',        'ZZ_DEMO_ Blasting/stencil (shop)',             NULL, NULL,                                   'Cathy',  'ZZ_DEMO_ tray: stencil + blast',               'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000009', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'repair',          'ZZ_DEMO_ Repair bench work (shop)',            NULL, NULL,                                   'Mike',   'ZZ_DEMO_ tray: bench repair',                  'planned',   NULL, now(), now()),
  ('e0000000-0000-4000-8000-000000000010', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — Ocean View (Toms River)',   NULL, 'b0000000-0000-4000-8000-000000000007', 'Lonnie', 'ZZ_DEMO_ tray: CANCELLED by customer',         'cancelled', NULL, now(), now()),

  -- ── SCHEDULED (12): next 2 weeks ──────────────────────────────────────────
  -- Thu (~5/28) — HEAVY DAY (4 batches)
  ('e0000000-0000-4000-8000-000000000011', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'foundation_trip', 'ZZ_DEMO_ Foundation trip — Perth Amboy cluster', current_date + 1,  'b0000000-0000-4000-8000-000000000001', 'Lonnie', 'ZZ_DEMO_ multi-stop cluster run',            'planned',   'am', now(), now()),
  ('e0000000-0000-4000-8000-000000000012', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'delivery',        'ZZ_DEMO_ Delivery run — Edison',                 current_date + 1,  'b0000000-0000-4000-8000-000000000005', 'Mike',   'ZZ_DEMO_ morning delivery',                  'planned',   'am', now(), now()),
  ('e0000000-0000-4000-8000-000000000013', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — Resurrection',                current_date + 1,  'b0000000-0000-4000-8000-000000000003', 'Lonnie', 'ZZ_DEMO_ afternoon set',                     'planned',   'pm', now(), now()),
  ('e0000000-0000-4000-8000-000000000014', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'acid_wash',       'ZZ_DEMO_ Acid wash (shop)',                      current_date + 1,  NULL,                                   'Cathy',  'ZZ_DEMO_ shop block',                        'planned',   'pm', now(), now()),
  -- Fri (~5/29) — 1 batch, all-day
  ('e0000000-0000-4000-8000-000000000015', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'blasting',        'ZZ_DEMO_ Blasting day (shop, all-day)',          current_date + 2,  NULL,                                   'Mike',   'ZZ_DEMO_ all-day, unslotted',                'planned',   NULL, now(), now()),
  -- Mon (~6/1) — EMPTY (no batch)
  -- Tue (~6/2) — 2 batches
  ('e0000000-0000-4000-8000-000000000016', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'foundation_trip', 'ZZ_DEMO_ Foundation trip — Trenton (outlier)',   current_date + 6,  'b0000000-0000-4000-8000-000000000006', 'Lonnie', 'ZZ_DEMO_ far outlier — long route',          'planned',   'am', now(), now()),
  ('e0000000-0000-4000-8000-000000000017', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'repair',          'ZZ_DEMO_ Repair bench (shop)',                   current_date + 6,  NULL,                                   'Mike',   'ZZ_DEMO_ shop block',                        'planned',   'pm', now(), now()),
  -- Wed (~6/3) — 1 batch, all-day
  ('e0000000-0000-4000-8000-000000000018', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — Ocean View (all-day, outlier)',current_date + 7, 'b0000000-0000-4000-8000-000000000007', 'Lonnie', 'ZZ_DEMO_ all-day far-outlier set',           'planned',   NULL, now(), now()),
  -- Thu (~6/4) — EMPTY
  -- Fri (~6/5) — 2 batches
  ('e0000000-0000-4000-8000-000000000019', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'delivery',        'ZZ_DEMO_ Delivery — Woodbridge',                 current_date + 9,  'b0000000-0000-4000-8000-000000000003', 'Mike',   'ZZ_DEMO_ morning delivery',                  'planned',   'am', now(), now()),
  ('e0000000-0000-4000-8000-000000000020', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — Hillside',                    current_date + 9,  'b0000000-0000-4000-8000-000000000001', 'Lonnie', 'ZZ_DEMO_ afternoon set',                     'planned',   'pm', now(), now()),
  -- Mon (~6/8) — 1 batch, event (0 jobs)
  ('e0000000-0000-4000-8000-000000000021', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'site_visit',      'ZZ_DEMO_ Site visit / estimate — Edison',        current_date + 12, 'b0000000-0000-4000-8000-000000000005', 'Cathy',  'ZZ_DEMO_ event: customer estimate, no jobs', 'planned',   'am', now(), now()),
  -- Tue (~6/9) — EMPTY
  -- Wed (~6/10) — 1 batch, event (0 jobs)
  ('e0000000-0000-4000-8000-000000000022', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'errand',          'ZZ_DEMO_ Errand — supplier pickup',              current_date + 14, NULL,                                   'Mike',   'ZZ_DEMO_ event: parts pickup, no jobs',      'planned',   'pm', now(), now()),

  -- ── PAST (3): recent past, drive overdue/late + completed coverage ─────────
  ('e0000000-0000-4000-8000-000000000023', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — St Mary''s (LATE)',           current_date - 7,  'b0000000-0000-4000-8000-000000000002', 'Lonnie', 'ZZ_DEMO_ overdue: never completed',          'running_late',  'am', now(), now()),
  ('e0000000-0000-4000-8000-000000000024', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'delivery',        'ZZ_DEMO_ Delivery — Edison (slipped)',           current_date - 5,  'b0000000-0000-4000-8000-000000000005', 'Mike',   'ZZ_DEMO_ started, not finished',             'in_progress',   'pm', now(), now()),
  ('e0000000-0000-4000-8000-000000000025', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'setting',         'ZZ_DEMO_ Setting — Hillside (done)',             current_date - 6,  'b0000000-0000-4000-8000-000000000001', 'Lonnie', 'ZZ_DEMO_ completed on time',                 'completed',     'am', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — Work batch jobs (~42 stop links)
-- ─────────────────────────────────────────────────────────────────────────────
-- stop_order: 1..n on field trips, NULL on shop blocks. Event batches (e..21,
-- e..22) get NO rows here. carry_over_from points back to an earlier stop row.
--
-- ORDERING NOTE: the carry_over_from self-FK is non-deferrable, so the PAST
-- batch stops that serve as carryover targets are inserted FIRST.

INSERT INTO work_batch_jobs (
  id, batch_id, job_id, stop_order, completed_at, completed_by, carry_over_from, created_at
) VALUES
  -- ── PAST batch stops first (carryover targets) ────────────────────────────
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000019', 1, NULL,                       NULL,     NULL, now()),  -- e23 LATE, d19 slipped
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000020', 2, NULL,                       NULL,     NULL, now()),  -- e23 LATE, d20 slipped
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000024', 'd0000000-0000-4000-8000-000000000014', 1, NULL,                       NULL,     NULL, now()),  -- e24 in_progress
  ('e1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000025', 'd0000000-0000-4000-8000-000000000024', 1, now() - interval '6 days', 'Lonnie', NULL, now()),  -- e25 completed
  -- ── TRAY batch stops ──────────────────────────────────────────────────────
  ('e1000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000019', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000020', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000016', 3, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000019', 1, NULL, NULL, 'e1000000-0000-4000-8000-000000000001', now()),  -- CARRYOVER: d19 from e23
  ('e1000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000020', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000014', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000015', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000017', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000018', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000005', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000015', 'e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000006', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000016', 'e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000009', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000017', 'e0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000012', NULL, NULL, NULL, NULL, now()),  -- shop block, stop_order NULL
  ('e1000000-0000-4000-8000-000000000018', 'e0000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000013', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000019', 'e0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000010', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000011', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000007', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000008', 1, NULL, NULL, NULL, now()),  -- cancelled batch's planned stop
  -- ── SCHEDULED batch stops ─────────────────────────────────────────────────
  ('e1000000-0000-4000-8000-000000000023', 'e0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000016', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000024', 'e0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000017', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000025', 'e0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000018', 3, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000026', 'e0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000014', 4, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000027', 'e0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000015', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000028', 'e0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000019', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000029', 'e0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000020', 1, NULL, NULL, 'e1000000-0000-4000-8000-000000000002', now()),  -- CARRYOVER: d20 from e23
  ('e1000000-0000-4000-8000-000000000030', 'e0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000016', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000031', 'e0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000011', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000032', 'e0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000012', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000033', 'e0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000010', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000034', 'e0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000013', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000035', 'e0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000009', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000036', 'e0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000021', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000037', 'e0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000007', NULL, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000038', 'e0000000-0000-4000-8000-000000000018', 'd0000000-0000-4000-8000-000000000022', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000039', 'e0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000023', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000003', 2, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000041', 'e0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000001', 1, NULL, NULL, NULL, now()),
  ('e1000000-0000-4000-8000-000000000042', 'e0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000002', 2, NULL, NULL, NULL, now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — Job promises (8)
-- ─────────────────────────────────────────────────────────────────────────────
-- 5 overdue (promised_date past, kept NULL → 🤡 at-risk) + 2 kept + 1 upcoming.
-- promised_by = plain crew name. notes carry the ZZ_DEMO_ prefix for clarity;
-- cleanup identifies these rows by job_id ∈ demo jobs, not by the note.

INSERT INTO job_promises (
  id, tenant_id, job_id, promised_by, promised_date, kept, resolved_at, notes, created_at
) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000005', 'Cathy',  current_date - 12, NULL, NULL,                       'ZZ_DEMO_ overdue: promised install date passed', now()),
  ('e2000000-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000009', 'Lonnie', current_date - 9,  NULL, NULL,                       'ZZ_DEMO_ overdue: customer waiting',              now()),
  ('e2000000-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000012', 'Mike',   current_date - 7,  NULL, NULL,                       'ZZ_DEMO_ overdue: rush order slipped',            now()),
  ('e2000000-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000016', 'Cathy',  current_date - 5,  NULL, NULL,                       'ZZ_DEMO_ overdue: veteran ceremony date',         now()),
  ('e2000000-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000019', 'Lonnie', current_date - 2,  NULL, NULL,                       'ZZ_DEMO_ overdue: just missed promise',           now()),
  ('e2000000-0000-4000-8000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000020', 'Cathy',  current_date - 17, true, now() - interval '18 days', 'ZZ_DEMO_ kept: delivered on time',                now()),
  ('e2000000-0000-4000-8000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000024', 'Mike',   current_date - 22, true, now() - interval '23 days', 'ZZ_DEMO_ kept: completed early',                  now()),
  ('e2000000-0000-4000-8000-000000000008', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'd0000000-0000-4000-8000-000000000003', 'Lonnie', current_date + 9,  NULL, NULL,                       'ZZ_DEMO_ upcoming: promised next week',           now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — Verification SELECTs
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'SEEDED — work_batches' AS phase, COUNT(*) AS rows
FROM work_batches WHERE LEFT(title, 8) = 'ZZ_DEMO_';

SELECT 'SEEDED — work_batches by schedule' AS phase,
       COUNT(*) FILTER (WHERE scheduled_date IS NULL)                          AS tray,
       COUNT(*) FILTER (WHERE scheduled_date >= current_date)                  AS scheduled_future,
       COUNT(*) FILTER (WHERE scheduled_date <  current_date)                  AS past
FROM work_batches WHERE LEFT(title, 8) = 'ZZ_DEMO_';

SELECT 'SEEDED — work_batch_jobs' AS phase, COUNT(*) AS rows
FROM work_batch_jobs
WHERE batch_id IN (SELECT id FROM work_batches WHERE LEFT(title, 8) = 'ZZ_DEMO_');

SELECT 'SEEDED — job_promises' AS phase,
       COUNT(*)                                              AS total,
       COUNT(*) FILTER (WHERE kept IS NULL AND promised_date < current_date) AS overdue
FROM job_promises
WHERE job_id IN (
  SELECT j.id FROM jobs j JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

SELECT 'SEEDED — cemeteries geocoded' AS phase, COUNT(*) AS rows
FROM cemeteries WHERE LEFT(name, 8) = 'ZZ_DEMO_' AND geocoded_lat IS NOT NULL;

COMMIT;
