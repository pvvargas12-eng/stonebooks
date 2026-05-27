-- =============================================================================
-- supabase/demo_seed_25_jobs.sql
-- Seeds 25 fake jobs across the new_stone template to populate every queue
-- section visually, with realistic monument-shop operational variation.
-- =============================================================================
--
-- PRECONDITION: Run supabase/demo_cleanup.sql first if any demo rows exist.
-- This seed assumes a clean demo-row state and uses deterministic UUIDs so
-- re-runs (after cleanup) produce identical IDs.
--
-- Tenant: Shevchenko default (a1b2c3d4-e5f6-7890-abcd-ef0123456789).
-- All demo rows carry ZZ_DEMO_ / DEMO- prefixes for safe cleanup.
--
-- =============================================================================
-- WHAT THIS SEED COVERS
--
-- Queue-section coverage:
--   Layouts:           Needs drawing / Awaiting approval / Ready to advance / Blocked
--   Stones:            To order / Ordered awaiting supplier / Received awaiting production / Blocked
--   Production:        Stencil prep / Ready for carving / In production / Complete awaiting install / Blocked
--   Waiting on customer (overall_status): aged 6d / 9d / 16d
--
-- Monument-shop realism:
--   • Single uprights (11), double uprights/companion (3), slants single (3),
--     slants double (2), bevel markers (1), flat markers (3), bronze plate (2),
--     custom shape (1)
--   • Granite colors: jet_black, bahama_blue, medium_barre_grey, mahogany,
--     imperial_red, georgia_gray, royal_pink, cats_eye, mountain_rose,
--     st_cloud_grey, cloud_gray
--   • Veteran / military examples (3): Cohen, Novak, Underwood
--   • Religious styling (4): DiMaggio (Catholic), Lopez (Catholic), Petrov
--     (Orthodox), Schmidt (Protestant)
--   • Photo/laser etching (3): Brennan, Jensen, Thompson
--   • Companion / pre-need reserved (3): Kowalski, DiMaggio, Underwood
--   • Rush order (1): Jensen
--   • Custom shape (1): Klein (heart)
--   • Vase add-on (1): Rossi
--   • Complex inscription (1): Quintero
--   • Pricing range: $1,600 (flat marker) to $14,000+ (premium granite companion)
--
-- Payment varieties (computed as % of pricing.grandTotal):
--   • Unpaid (9 orders): payments=[], pricing.paymentStatus='unpaid'
--   • Partial (10 orders): one locked deposit at 50% of pricing.grandTotal,
--     pricing.paymentStatus='partial' (merged in Step 7)
--   • Paid in full (6 orders): deposit + balance summing to pricing.grandTotal,
--     pricing.paymentStatus='paid_in_full' (merged in Step 7)
--
-- All pricing data lives inside the pricing JSONB column. Verified 2026-05-21:
-- orders has no scalar subtotal / sales_tax / grand_total columns; all
-- monetary fields are inside pricing as { subtotal, salesTax, grandTotal,
-- depositRequired, balanceRemaining, paymentStatus }.
--
-- Aging variety: scenarios span same-day (0d) to 4-month-old jobs (120d).
--
-- =============================================================================
-- IDEMPOTENCY
-- All INSERTs use deterministic UUIDs + ON CONFLICT (id) DO NOTHING.
-- The milestone-snapshot INSERT skips rows already present (NOT EXISTS check).
-- UPDATE statements are idempotent — running again produces the same final state.
-- Safe to re-run after cleanup with no side effects.
--
-- =============================================================================
-- TEMPLATE ASSUMPTION
-- All 25 scenarios use the new_stone template. Bronze / inscription /
-- cleaning_repair scenarios deferred — they require verifying additional
-- milestone keys before safe seeding.
--
-- Milestone key assumptions for new_stone (verified via prior SQL inspections):
--   intake_complete, design_needed, proof_created, proof_sent, proof_approved,
--   stone_ordered, stone_received, stencil_created, stencil_cut,
--   production_started, production_completed, foundation_poured,
--   ready_to_install, installed
--
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — Cemeteries (3 reused across orders)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO cemeteries (id, tenant_id, name, created_at)
VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Hillside Cemetery',     now()),
  ('b0000000-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_St Mary''s Cemetery',   now()),
  ('b0000000-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'ZZ_DEMO_Resurrection Cemetery', now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — Customers (25, one per scenario)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO customers (id, tenant_id, first_name, last_name, created_at)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'John',     'ZZ_DEMO_Anderson',  now()),
  ('a0000000-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Maria',    'ZZ_DEMO_Kowalski',  now()),
  ('a0000000-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Carlos',   'ZZ_DEMO_Martinez',  now()),
  ('a0000000-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Linda',    'ZZ_DEMO_Brennan',   now()),
  ('a0000000-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Robert',   'ZZ_DEMO_Cohen',     now()),
  ('a0000000-0000-4000-8000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Sophia',   'ZZ_DEMO_DiMaggio',  now()),
  ('a0000000-0000-4000-8000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'James',    'ZZ_DEMO_Edwards',   now()),
  ('a0000000-0000-4000-8000-000000000008', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Ana',      'ZZ_DEMO_Fontana',   now()),
  ('a0000000-0000-4000-8000-000000000009', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Daniel',   'ZZ_DEMO_Garcia',    now()),
  ('a0000000-0000-4000-8000-000000000010', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Hannah',   'ZZ_DEMO_Hoffman',   now()),
  ('a0000000-0000-4000-8000-000000000011', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Ivan',     'ZZ_DEMO_Ivanov',    now()),
  ('a0000000-0000-4000-8000-000000000012', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Julia',    'ZZ_DEMO_Jensen',    now()),
  ('a0000000-0000-4000-8000-000000000013', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Karl',     'ZZ_DEMO_Klein',     now()),
  ('a0000000-0000-4000-8000-000000000014', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Lara',     'ZZ_DEMO_Lopez',     now()),
  ('a0000000-0000-4000-8000-000000000015', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Michael',  'ZZ_DEMO_Murphy',    now()),
  ('a0000000-0000-4000-8000-000000000016', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Nina',     'ZZ_DEMO_Novak',     now()),
  ('a0000000-0000-4000-8000-000000000017', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Omar',     'ZZ_DEMO_Ortiz',     now()),
  ('a0000000-0000-4000-8000-000000000018', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Petra',    'ZZ_DEMO_Petrov',    now()),
  ('a0000000-0000-4000-8000-000000000019', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Quincy',   'ZZ_DEMO_Quintero',  now()),
  ('a0000000-0000-4000-8000-000000000020', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Rosa',     'ZZ_DEMO_Rossi',     now()),
  ('a0000000-0000-4000-8000-000000000021', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Stefan',   'ZZ_DEMO_Schmidt',   now()),
  ('a0000000-0000-4000-8000-000000000022', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Tara',     'ZZ_DEMO_Thompson',  now()),
  ('a0000000-0000-4000-8000-000000000023', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Ursula',   'ZZ_DEMO_Underwood', now()),
  ('a0000000-0000-4000-8000-000000000024', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Viktor',   'ZZ_DEMO_Volkov',    now()),
  ('a0000000-0000-4000-8000-000000000025', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'Wendy',    'ZZ_DEMO_Walsh',     now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — Orders (25, base columns)
-- ─────────────────────────────────────────────────────────────────────────────
-- Minimum essential columns. Realism fields land in Step 3.5 via UPDATEs.

-- NOTE: primary_lastname is a GENERATED column on orders — Postgres derives it
-- from elsewhere on insert. It is intentionally omitted from this column list;
-- writing to it would error with "cannot insert a non-DEFAULT value into
-- column 'primary_lastname'". The seed relies on the generated value being
-- derived correctly from the linked customer's last_name (or whatever the
-- generation expression uses). Verified 2026-05-21.

INSERT INTO orders (
  id, tenant_id, order_number, customer_id, cemetery_id,
  service_types, status, signed_at, target_completion_date,
  designs, payments, created_at
) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 2,  current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000002', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 5,  current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '5 days'),
  ('c0000000-0000-4000-8000-000000000003', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-003', 'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 6,  current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '6 days'),
  ('c0000000-0000-4000-8000-000000000004', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-004', 'a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 10, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '10 days'),
  ('c0000000-0000-4000-8000-000000000005', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-005', 'a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 15, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '15 days'),
  ('c0000000-0000-4000-8000-000000000006', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-006', 'a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 22, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '22 days'),
  ('c0000000-0000-4000-8000-000000000007', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-007', 'a0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 20, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '20 days'),
  ('c0000000-0000-4000-8000-000000000008', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-008', 'a0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 18, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '18 days'),
  ('c0000000-0000-4000-8000-000000000009', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-009', 'a0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 25, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '25 days'),
  ('c0000000-0000-4000-8000-000000000010', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-010', 'a0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 30, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '30 days'),
  ('c0000000-0000-4000-8000-000000000011', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-011', 'a0000000-0000-4000-8000-000000000011', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 28, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '28 days'),
  ('c0000000-0000-4000-8000-000000000012', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-012', 'a0000000-0000-4000-8000-000000000012', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 40, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '40 days'),
  ('c0000000-0000-4000-8000-000000000013', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-013', 'a0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 50, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '50 days'),
  ('c0000000-0000-4000-8000-000000000014', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-014', 'a0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 60, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '60 days'),
  ('c0000000-0000-4000-8000-000000000015', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-015', 'a0000000-0000-4000-8000-000000000015', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 65, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '65 days'),
  ('c0000000-0000-4000-8000-000000000016', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-016', 'a0000000-0000-4000-8000-000000000016', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 70, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '70 days'),
  ('c0000000-0000-4000-8000-000000000017', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-017', 'a0000000-0000-4000-8000-000000000017', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 75, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '75 days'),
  ('c0000000-0000-4000-8000-000000000018', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-018', 'a0000000-0000-4000-8000-000000000018', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 80, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '80 days'),
  ('c0000000-0000-4000-8000-000000000019', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-019', 'a0000000-0000-4000-8000-000000000019', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 85, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '85 days'),
  ('c0000000-0000-4000-8000-000000000020', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-020', 'a0000000-0000-4000-8000-000000000020', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'in_production', current_date - 90, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '90 days'),
  ('c0000000-0000-4000-8000-000000000021', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-021', 'a0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 12, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '12 days'),
  ('c0000000-0000-4000-8000-000000000022', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-022', 'a0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 30, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '30 days'),
  ('c0000000-0000-4000-8000-000000000023', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-023', 'a0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000002',
   ARRAY['NEW_STONE']::text[], 'contracted', current_date - 55, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '55 days'),
  ('c0000000-0000-4000-8000-000000000024', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-024', 'a0000000-0000-4000-8000-000000000024', 'b0000000-0000-4000-8000-000000000003',
   ARRAY['NEW_STONE']::text[], 'paid_in_full', current_date - 85, current_date + interval '5 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '85 days'),
  ('c0000000-0000-4000-8000-000000000025', 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'DEMO-025', 'a0000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000001',
   ARRAY['NEW_STONE']::text[], 'installed', current_date - 120, current_date + interval '4 months',
   '[]'::jsonb, '[]'::jsonb, now() - interval '120 days')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3.5 — Realism enrichment (monument-shop operational variation)
-- ─────────────────────────────────────────────────────────────────────────────
-- Each scenario gets its monument profile, inscription, deceased, pricing,
-- and operational notes. Idempotent — running again writes the same values.

-- DEMO-001 — Anderson: Recent loss, single mother, classic single upright.
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 28, width_inches = 24, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         5625.00,
    'salesTax',         372.66,
    'grandTotal',       5997.66,
    'depositRequired',  ROUND(5997.66 / 2.0, 2),
    'balanceRemaining', 5997.66,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Anderson',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Margaret', 'middleName', 'Eleanor', 'lastName', 'Anderson',
    'dateOfBirth', '1935-04-12', 'dateOfDeath', '2025-11-08',
    'isReserved', false,
    'title', 'Beloved Mother',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Mother')
  )),
  design_preferences = 'Traditional script lettering. Customer prefers simple, elegant layout.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-001';

-- DEMO-002 — Kowalski: Companion couple, husband deceased, wife pre-need reserved.
UPDATE orders SET
  granite_color = 'bahama_blue',
  shape = 'upright-double',
  shape_subtype = 'companion',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 30, width_inches = 48, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         10400.00,
    'salesTax',         689.00,
    'grandTotal',       11089.00,
    'depositRequired',  ROUND(11089.00 / 2.0, 2),
    'balanceRemaining', 11089.00,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'cross-etching', 'label', 'Latin Cross etching', 'qty', 1, 'price', 250
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'side_by_side',
    'familyName', 'Kowalski',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(
    jsonb_build_object(
      'firstName', 'Henryk', 'lastName', 'Kowalski',
      'dateOfBirth', '1942-02-15', 'dateOfDeath', '2023-09-22',
      'isReserved', false,
      'title', 'Beloved Husband and Father',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
    ),
    jsonb_build_object(
      'firstName', 'Anya', 'lastName', 'Kowalski',
      'dateOfBirth', NULL, 'dateOfDeath', NULL,
      'isReserved', true,
      'title', NULL
    )
  ),
  design_preferences = 'Side-by-side companion layout. Surname banner centered above both panels.',
  timeline_notes = 'Pre-need reservation for spouse — confirm layout side preference at design review.'
WHERE order_number = 'DEMO-002';

-- DEMO-003 — Martinez: Loving father, single slant marker.
UPDATE orders SET
  granite_color = 'medium_barre_grey',
  shape = 'slant',
  shape_subtype = 'standard',
  finish = 'polished_top_sandblasted_sides',
  polish_level = 'P3',
  height_inches = 16, width_inches = 36, thickness_inches = 12,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         2800.00,
    'salesTax',         185.50,
    'grandTotal',       2985.50,
    'depositRequired',  ROUND(2985.50 / 2.0, 2),
    'balanceRemaining', 2985.50,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Martinez',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Juan', 'middleName', 'Carlos', 'lastName', 'Martinez',
    'dateOfBirth', '1958-07-04', 'dateOfDeath', '2026-02-14',
    'isReserved', false,
    'title', 'Loving Father',
    'titlePrefix', 'Loving', 'titleRelations', jsonb_build_array('Father')
  )),
  design_preferences = 'Simple sans-serif lettering. Customer prefers understated design.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-003';

-- DEMO-004 — Brennan: Photo-etched single upright, fishing trip photo.
UPDATE orders SET
  granite_color = 'mahogany',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 32, width_inches = 28, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         7425.00,
    'salesTax',         491.91,
    'grandTotal',       7916.91,
    'depositRequired',  ROUND(7916.91 / 2.0, 2),
    'balanceRemaining', 7916.91,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'laser-etching-photo-large',
    'label', 'Laser-etched photo (large, 12x16)',
    'qty', 1, 'price', 700
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Brennan',
    'dateFormat', 'standard',
    'styleTreatment', 'scroll',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Patrick', 'middleName', 'James', 'lastName', 'Brennan',
    'dateOfBirth', '1948-03-17', 'dateOfDeath', '2025-08-30',
    'isReserved', false,
    'title', 'Beloved Husband, Father, and Friend',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father', 'Friend')
  )),
  design_preferences = 'Customer providing photo of Patrick on fishing trip — to be laser-etched on stone face above inscription.',
  timeline_notes = 'Awaiting customer photo upload (.JPG, high-res). Etching cannot begin until received.'
WHERE order_number = 'DEMO-004';

-- DEMO-005 — Cohen: US Army veteran, Memorial Day deadline.
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 30, width_inches = 26, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         6650.00,
    'salesTax',         440.56,
    'grandTotal',       7090.56,
    'depositRequired',  ROUND(7090.56 / 2.0, 2),
    'balanceRemaining', 7090.56,
    'paymentStatus',    'unpaid'
  ),
  cemetery_deadline = current_date + 4,
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'military-us-army', 'label', 'US Army emblem (carved)', 'qty', 1, 'price', 300),
    jsonb_build_object('code', 'star-of-david-etching', 'label', 'Star of David etching', 'qty', 1, 'price', 150)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Cohen',
    'dateFormat', 'standard',
    'styleTreatment', 'banner',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'David', 'middleName', 'Aaron', 'lastName', 'Cohen',
    'dateOfBirth', '1945-06-22', 'dateOfDeath', '2024-12-11',
    'isReserved', false,
    'title', 'Beloved Husband, Father, and US Army Veteran',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
  )),
  design_preferences = 'Military service prominently displayed. US Army emblem upper-center, Star of David top-left of name.',
  timeline_notes = 'Family requested installation before Memorial Day ceremony — Hillside Section C.'
WHERE order_number = 'DEMO-005';

-- DEMO-006 — DiMaggio: Italian-American Catholic companion couple.
UPDATE orders SET
  granite_color = 'imperial_red',
  shape = 'upright-double',
  shape_subtype = 'companion',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 36, width_inches = 60, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         12825.00,
    'salesTax',         849.66,
    'grandTotal',       13674.66,
    'depositRequired',  ROUND(13674.66 / 2.0, 2),
    'balanceRemaining', 13674.66,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'crucifix-large-carved', 'label', 'Large carved crucifix', 'qty', 1, 'price', 500),
    jsonb_build_object('code', 'rosary-etching', 'label', 'Rosary etching (wrapping crucifix)', 'qty', 1, 'price', 200)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'DiMaggio',
    'dateFormat', 'standard',
    'styleTreatment', 'old_english',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(
    jsonb_build_object(
      'firstName', 'Giuseppe', 'middleName', 'Antonio', 'lastName', 'DiMaggio',
      'dateOfBirth', '1935-09-04', 'dateOfDeath', '2026-04-08',
      'isReserved', false,
      'title', 'Beloved Husband and Father',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
    ),
    jsonb_build_object(
      'firstName', 'Maria', 'lastName', 'DiMaggio',
      'isReserved', true
    )
  ),
  design_preferences = 'Catholic styling. Large carved crucifix centered. Old English lettering for surname banner. Italian-language epitaph optional, to confirm.',
  timeline_notes = 'Customer reviewing Italian-language epitaph wording with priest before approval.'
WHERE order_number = 'DEMO-006';

-- DEMO-007 — Edwards: Simple bevel marker, single.
UPDATE orders SET
  granite_color = 'georgia_gray',
  shape = 'bevel',
  shape_subtype = 'standard',
  finish = 'polished_top',
  polish_level = 'P3',
  height_inches = 8, width_inches = 24, thickness_inches = 16,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         1800.00,
    'salesTax',         119.25,
    'grandTotal',       1919.25,
    'depositRequired',  ROUND(1919.25 / 2.0, 2),
    'balanceRemaining', 1919.25,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Edwards',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Thomas', 'middleName', 'Wayne', 'lastName', 'Edwards',
    'dateOfBirth', '1952-11-30', 'dateOfDeath', '2025-09-18',
    'isReserved', false,
    'title', 'In Loving Memory',
    'titlePrefix', NULL, 'titleRelations', jsonb_build_array()
  )),
  design_preferences = 'Bevel marker for family plot. Simple lettering, minimal decoration.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-007';

-- DEMO-008 — Fontana: Bronze memorial plate on flat granite base.
UPDATE orders SET
  granite_color = 'cloud_gray',
  shape = 'flat',
  shape_subtype = 'bronze_base',
  finish = 'polished_top',
  polish_level = 'P3',
  height_inches = 4, width_inches = 24, thickness_inches = 14,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         3000.00,
    'salesTax',         198.75,
    'grandTotal',       3198.75,
    'depositRequired',  ROUND(3198.75 / 2.0, 2),
    'balanceRemaining', 3198.75,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'bronze-plate-24x12-standard',
    'label', '24x12 Bronze memorial plate (standard finish)',
    'qty', 1, 'price', 1800
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Fontana',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Antonio', 'lastName', 'Fontana',
    'dateOfBirth', '1940-01-25', 'dateOfDeath', '2024-06-03',
    'isReserved', false,
    'title', 'Beloved Father',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Father')
  )),
  design_preferences = 'Bronze plate on flat granite base. Customer wants traditional raised-letter bronze.',
  timeline_notes = 'Bronze plate ordered from vendor — typical 4-month lead time.'
WHERE order_number = 'DEMO-008';

-- DEMO-009 — Garcia: Large premium single upright.
UPDATE orders SET
  granite_color = 'royal_pink',
  shape = 'upright-single',
  shape_subtype = 'oversized',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 36, width_inches = 30, thickness_inches = 8,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         10125.00,
    'salesTax',         670.78,
    'grandTotal',       10795.78,
    'depositRequired',  ROUND(10795.78 / 2.0, 2),
    'balanceRemaining', 10795.78,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Garcia',
    'dateFormat', 'standard',
    'styleTreatment', 'scroll',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Esperanza', 'middleName', 'Rosa', 'lastName', 'Garcia',
    'dateOfBirth', '1939-12-08', 'dateOfDeath', '2025-06-14',
    'isReserved', false,
    'title', 'Beloved Mother, Grandmother, and Great-Grandmother',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Mother', 'Grandmother', 'Great-Grandmother')
  )),
  design_preferences = 'Large monument with scroll treatment around name. Spanish-language epitaph to be confirmed with family.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-009';

-- DEMO-010 — Hoffman: Flat grass marker, no permit needed.
UPDATE orders SET
  granite_color = 'medium_barre_grey',
  shape = 'flat',
  shape_subtype = 'bevel_grass',
  finish = 'polished_top',
  polish_level = 'P3',
  height_inches = 4, width_inches = 24, thickness_inches = 14,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         1500.00,
    'salesTax',         99.38,
    'grandTotal',       1599.38,
    'depositRequired',  ROUND(1599.38 / 2.0, 2),
    'balanceRemaining', 1599.38,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Hoffman',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'William', 'lastName', 'Hoffman',
    'dateOfBirth', '1947-08-19', 'dateOfDeath', '2025-04-22',
    'isReserved', false,
    'title', 'Beloved Husband',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband')
  )),
  design_preferences = 'Flat grass marker. Standard inscription, no decoration.',
  timeline_notes = 'Cemetery does not require permit for flat markers — straight to production after approval.'
WHERE order_number = 'DEMO-010';

-- DEMO-011 — Ivanov: Slant double companion.
UPDATE orders SET
  granite_color = 'bahama_blue',
  shape = 'slant',
  shape_subtype = 'double_companion',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 16, width_inches = 48, thickness_inches = 12,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         7150.00,
    'salesTax',         473.69,
    'grandTotal',       7623.69,
    'depositRequired',  ROUND(7623.69 / 2.0, 2),
    'balanceRemaining', 7623.69,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'side_by_side',
    'familyName', 'Ivanov',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(
    jsonb_build_object(
      'firstName', 'Boris', 'lastName', 'Ivanov',
      'dateOfBirth', '1940-05-09', 'dateOfDeath', '2025-03-12',
      'isReserved', false,
      'title', 'Beloved Husband and Father',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
    ),
    jsonb_build_object(
      'firstName', 'Natalia', 'lastName', 'Ivanov',
      'isReserved', true
    )
  ),
  design_preferences = 'Cyrillic-language inscription option pending family confirmation.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-011';

-- DEMO-012 — Jensen: Rush order, photo etching, anniversary deadline.
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 28, width_inches = 24, thickness_inches = 6,
  rush_order = true,
  pricing = jsonb_build_object(
    'subtotal',         7425.00,
    'salesTax',         491.91,
    'grandTotal',       7916.91,
    'depositRequired',  ROUND(7916.91 / 2.0, 2),
    'balanceRemaining', 7916.91,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'laser-etching-photo-medium', 'label', 'Laser-etched photo (medium, 8x10)', 'qty', 1, 'price', 550),
    jsonb_build_object('code', 'religious-symbol-cross', 'label', 'Cross symbol etching', 'qty', 1, 'price', 150)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Jensen',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Anders', 'middleName', 'Lars', 'lastName', 'Jensen',
    'dateOfBirth', '1962-10-04', 'dateOfDeath', '2025-12-15',
    'isReserved', false,
    'title', 'Beloved Husband and Father',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
  )),
  design_preferences = 'RUSH — family wants installation by one-year anniversary of passing.',
  timeline_notes = 'RUSH ORDER. Target installation by Dec 15, 2026 (1-year mark). Compressed timeline; supplier order placed expedited.'
WHERE order_number = 'DEMO-012';

-- DEMO-013 — Klein: Custom heart-shaped monument.
UPDATE orders SET
  granite_color = 'royal_pink',
  shape = 'custom',
  shape_subtype = 'heart_shaped',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 28, width_inches = 28, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         9450.00,
    'salesTax',         625.06,
    'grandTotal',       10075.06,
    'depositRequired',  ROUND(10075.06 / 2.0, 2),
    'balanceRemaining', 10075.06,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Klein',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Rebecca', 'lastName', 'Klein',
    'dateOfBirth', '1985-02-14', 'dateOfDeath', '2025-07-20',
    'isReserved', false,
    'title', 'Forever in Our Hearts',
    'titlePrefix', NULL, 'titleRelations', jsonb_build_array()
  )),
  design_preferences = 'Heart-shaped custom monument. Supplier custom-cut. Inscription centered.',
  timeline_notes = 'Custom shape requires supplier custom-cut — longer-than-typical lead time. Stone supplier confirmed cut spec.'
WHERE order_number = 'DEMO-013';

-- DEMO-014 — Lopez: Catholic, religious styling.
UPDATE orders SET
  granite_color = 'cats_eye',
  shape = 'upright-single',
  shape_subtype = 'gothic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 32, width_inches = 26, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         8100.00,
    'salesTax',         536.63,
    'grandTotal',       8636.63,
    'depositRequired',  ROUND(8636.63 / 2.0, 2),
    'balanceRemaining', 8636.63,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'crucifix-carved', 'label', 'Carved crucifix (medium)', 'qty', 1, 'price', 350),
    jsonb_build_object('code', 'praying-hands-etching', 'label', 'Praying hands etching', 'qty', 1, 'price', 200)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Lopez',
    'dateFormat', 'standard',
    'styleTreatment', 'old_english',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Carmen', 'middleName', 'Lucia', 'lastName', 'Lopez',
    'dateOfBirth', '1948-08-15', 'dateOfDeath', '2025-10-02',
    'isReserved', false,
    'title', 'Devoted Wife, Loving Mother',
    'titlePrefix', NULL, 'titleRelations', jsonb_build_array('Wife', 'Mother')
  )),
  design_preferences = 'Gothic-style upright with carved crucifix centered above name. Praying hands etching below dates.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-014';

-- DEMO-015 — Murphy: Slant marker.
UPDATE orders SET
  granite_color = 'mahogany',
  shape = 'slant',
  shape_subtype = 'standard',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 16, width_inches = 36, thickness_inches = 12,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         4725.00,
    'salesTax',         313.03,
    'grandTotal',       5038.03,
    'depositRequired',  ROUND(5038.03 / 2.0, 2),
    'balanceRemaining', 5038.03,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Murphy',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Sean', 'lastName', 'Murphy',
    'dateOfBirth', '1955-03-17', 'dateOfDeath', '2025-05-01',
    'isReserved', false,
    'title', 'Beloved Father and Grandfather',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Father', 'Grandfather')
  )),
  design_preferences = 'Standard slant. Customer wants Irish Celtic accent — small claddagh ring etching to be quoted.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-015';

-- DEMO-016 — Novak: USMC veteran with bronze service plate.
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 30, width_inches = 26, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         8050.00,
    'salesTax',         533.31,
    'grandTotal',       8583.31,
    'depositRequired',  ROUND(8583.31 / 2.0, 2),
    'balanceRemaining', 8583.31,
    'paymentStatus',    'unpaid'
  ),
  cemetery_deadline = current_date + 4,
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'military-usmc', 'label', 'USMC emblem (carved)', 'qty', 1, 'price', 300),
    jsonb_build_object('code', 'bronze-plate-veteran-service', 'label', 'Bronze veteran service plate', 'qty', 1, 'price', 1200)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Novak',
    'dateFormat', 'standard',
    'styleTreatment', 'banner',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Frank', 'middleName', 'Joseph', 'lastName', 'Novak',
    'dateOfBirth', '1944-07-04', 'dateOfDeath', '2024-08-29',
    'isReserved', false,
    'title', 'Beloved Husband, Father, USMC Vietnam Veteran',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
  )),
  design_preferences = 'USMC emblem upper-center. Bronze veteran plate below dates. Service banner around name.',
  timeline_notes = 'Family requested installation before Memorial Day veterans ceremony.'
WHERE order_number = 'DEMO-016';

-- DEMO-017 — Ortiz: Flat marker with bronze plate.
UPDATE orders SET
  granite_color = 'cloud_gray',
  shape = 'flat',
  shape_subtype = 'bronze_base',
  finish = 'polished_top',
  polish_level = 'P3',
  height_inches = 4, width_inches = 24, thickness_inches = 14,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         3200.00,
    'salesTax',         212.00,
    'grandTotal',       3412.00,
    'depositRequired',  ROUND(3412.00 / 2.0, 2),
    'balanceRemaining', 3412.00,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'bronze-plate-24x12-standard',
    'label', '24x12 Bronze memorial plate (standard)',
    'qty', 1, 'price', 2000
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Ortiz',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Luis', 'middleName', 'Miguel', 'lastName', 'Ortiz',
    'dateOfBirth', '1949-09-12', 'dateOfDeath', '2024-11-30',
    'isReserved', false,
    'title', 'Beloved Father',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Father')
  )),
  design_preferences = 'Bronze plate on flat granite base. Spanish-English bilingual inscription.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-017';

-- DEMO-018 — Petrov: Eastern Orthodox double slant.
UPDATE orders SET
  granite_color = 'st_cloud_grey',
  shape = 'slant',
  shape_subtype = 'double_companion',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 16, width_inches = 48, thickness_inches = 12,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         5500.00,
    'salesTax',         364.38,
    'grandTotal',       5864.38,
    'depositRequired',  ROUND(5864.38 / 2.0, 2),
    'balanceRemaining', 5864.38,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'orthodox-cross-three-bar', 'label', 'Russian Orthodox three-bar cross', 'qty', 2, 'price', 200
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'side_by_side',
    'familyName', 'Petrov',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(
    jsonb_build_object(
      'firstName', 'Sergei', 'lastName', 'Petrov',
      'dateOfBirth', '1943-12-25', 'dateOfDeath', '2024-05-09',
      'isReserved', false,
      'title', 'Beloved Husband',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband')
    ),
    jsonb_build_object(
      'firstName', 'Tatiana', 'lastName', 'Petrov',
      'dateOfBirth', '1947-04-18', 'dateOfDeath', '2025-01-22',
      'isReserved', false,
      'title', 'Beloved Wife',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Wife')
    )
  ),
  design_preferences = 'Russian Orthodox three-bar cross on each panel. Cyrillic-language inscription preferred.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-018';

-- DEMO-019 — Quintero: Complex three-line inscription with epitaph.
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 32, width_inches = 28, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         6875.00,
    'salesTax',         455.47,
    'grandTotal',       7330.47,
    'depositRequired',  ROUND(7330.47 / 2.0, 2),
    'balanceRemaining', 7330.47,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Quintero',
    'dateFormat', 'year_name_year',
    'styleTreatment', 'scroll',
    'sideToConfirm', false,
    'epitaph', 'No despidas — hasta luego.'
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Eduardo', 'middleName', 'Ricardo Manuel', 'lastName', 'Quintero',
    'dateOfBirth', '1936-11-15', 'dateOfDeath', '2025-02-14',
    'isReserved', false,
    'title', 'Devoted Husband, Father, Grandfather, and Friend',
    'titlePrefix', NULL, 'titleRelations', jsonb_build_array('Husband', 'Father', 'Grandfather', 'Friend')
  )),
  design_preferences = 'Year Name Year date format. Three-line name (Eduardo / Ricardo Manuel / Quintero). Spanish epitaph below dates. Scroll treatment.',
  timeline_notes = 'Complex layout — extra design review checkpoint added before customer approval.'
WHERE order_number = 'DEMO-019';

-- DEMO-020 — Rossi: Single upright with vase add-on.
UPDATE orders SET
  granite_color = 'cloud_gray',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 28, width_inches = 24, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         4865.00,
    'salesTax',         322.30,
    'grandTotal',       5187.30,
    'depositRequired',  ROUND(5187.30 / 2.0, 2),
    'balanceRemaining', 5187.30,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'vase-6x6x10-classical',
    'label', 'Vase 6x6x10 — classical shape',
    'qty', 1, 'price', 365,
    'vaseColor', 'cloud_gray'
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Rossi',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Lucia', 'lastName', 'Rossi',
    'dateOfBirth', '1951-06-30', 'dateOfDeath', '2024-09-08',
    'isReserved', false,
    'title', 'Beloved Mother and Grandmother',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Mother', 'Grandmother')
  )),
  design_preferences = 'Single matching-color vase, classical shape. Right-side placement.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-020';

-- DEMO-021 — Schmidt: Slant with Protestant cross.
UPDATE orders SET
  granite_color = 'medium_barre_grey',
  shape = 'slant',
  shape_subtype = 'standard',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 16, width_inches = 36, thickness_inches = 12,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         3000.00,
    'salesTax',         198.75,
    'grandTotal',       3198.75,
    'depositRequired',  ROUND(3198.75 / 2.0, 2),
    'balanceRemaining', 3198.75,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'plain-cross-etching', 'label', 'Plain cross etching', 'qty', 1, 'price', 150
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Schmidt',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Heinrich', 'lastName', 'Schmidt',
    'dateOfBirth', '1944-04-20', 'dateOfDeath', '2025-09-12',
    'isReserved', false,
    'title', 'Beloved Husband and Father',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
  )),
  design_preferences = 'Simple Lutheran cross above name. Plain lettering throughout.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-021';

-- DEMO-022 — Thompson: Photo etching, partial-pay scenario.
UPDATE orders SET
  granite_color = 'mahogany',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 30, width_inches = 26, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         7425.00,
    'salesTax',         491.91,
    'grandTotal',       7916.91,
    'depositRequired',  ROUND(7916.91 / 2.0, 2),
    'balanceRemaining', 7916.91,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(jsonb_build_object(
    'code', 'laser-etching-photo-medium',
    'label', 'Laser-etched photo (medium, 8x10)',
    'qty', 1, 'price', 550
  )),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Thompson',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Eleanor', 'middleName', 'Mae', 'lastName', 'Thompson',
    'dateOfBirth', '1938-08-25', 'dateOfDeath', '2025-04-10',
    'isReserved', false,
    'title', 'Beloved Mother and Grandmother',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Mother', 'Grandmother')
  )),
  design_preferences = 'Family-supplied photo (graduation portrait) to be etched on stone face. Standard inscription below.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-022';

-- DEMO-023 — Underwood: US Navy veteran companion couple.
UPDATE orders SET
  granite_color = 'imperial_red',
  shape = 'upright-double',
  shape_subtype = 'companion',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 36, width_inches = 60, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         13325.00,
    'salesTax',         882.78,
    'grandTotal',       14207.78,
    'depositRequired',  ROUND(14207.78 / 2.0, 2),
    'balanceRemaining', 14207.78,
    'paymentStatus',    'unpaid'
  ),
  add_ons = jsonb_build_array(
    jsonb_build_object('code', 'military-us-navy', 'label', 'US Navy emblem (carved)', 'qty', 1, 'price', 300),
    jsonb_build_object('code', 'american-flag-etching', 'label', 'American flag etching', 'qty', 1, 'price', 200)
  ),
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Underwood',
    'dateFormat', 'standard',
    'styleTreatment', 'banner',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(
    jsonb_build_object(
      'firstName', 'John', 'middleName', 'Robert', 'lastName', 'Underwood',
      'dateOfBirth', '1942-07-04', 'dateOfDeath', '2023-11-11',
      'isReserved', false,
      'title', 'Beloved Husband, Father, US Navy WWII Veteran',
      'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband', 'Father')
    ),
    jsonb_build_object(
      'firstName', 'Helen', 'lastName', 'Underwood',
      'isReserved', true
    )
  ),
  design_preferences = 'US Navy emblem centered top. American flag etching below dates. Wife pre-need reserved on right panel.',
  timeline_notes = 'Pre-need for surviving spouse. Confirm side-arrangement preference (husband left or right) at design review.'
WHERE order_number = 'DEMO-023';

-- DEMO-024 — Volkov: Standard single upright, paid in full.
UPDATE orders SET
  granite_color = 'georgia_gray',
  shape = 'upright-single',
  shape_subtype = 'classic',
  finish = 'polished',
  polish_level = 'P5',
  height_inches = 28, width_inches = 24, thickness_inches = 6,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         4200.00,
    'salesTax',         278.25,
    'grandTotal',       4478.25,
    'depositRequired',  ROUND(4478.25 / 2.0, 2),
    'balanceRemaining', 4478.25,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Volkov',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Mikhail', 'lastName', 'Volkov',
    'dateOfBirth', '1955-12-31', 'dateOfDeath', '2024-07-08',
    'isReserved', false,
    'title', 'Beloved Husband',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Husband')
  )),
  design_preferences = 'Standard layout, no special features. Customer paid in full at signing.',
  timeline_notes = NULL
WHERE order_number = 'DEMO-024';

-- DEMO-025 — Walsh: Flat family marker, installed (carry-over from prior year).
UPDATE orders SET
  granite_color = 'jet_black',
  shape = 'flat',
  shape_subtype = 'bevel_grass',
  finish = 'polished_top',
  polish_level = 'P3',
  height_inches = 4, width_inches = 24, thickness_inches = 14,
  rush_order = false,
  pricing = jsonb_build_object(
    'subtotal',         2250.00,
    'salesTax',         149.06,
    'grandTotal',       2399.06,
    'depositRequired',  ROUND(2399.06 / 2.0, 2),
    'balanceRemaining', 2399.06,
    'paymentStatus',    'unpaid'
  ),
  add_ons = '[]'::jsonb,
  inscription = jsonb_build_object(
    'layoutStyle', 'centered_family_name',
    'familyName', 'Walsh',
    'dateFormat', 'standard',
    'styleTreatment', 'plain',
    'sideToConfirm', false
  ),
  deceased = jsonb_build_array(jsonb_build_object(
    'firstName', 'Margaret', 'lastName', 'Walsh',
    'dateOfBirth', '1932-01-15', 'dateOfDeath', '2024-12-03',
    'isReserved', false,
    'title', 'Beloved Mother',
    'titlePrefix', 'Beloved', 'titleRelations', jsonb_build_array('Mother')
  )),
  design_preferences = 'Family plot marker. Already installed; outstanding closeout step is admin paperwork only.',
  timeline_notes = 'Installation completed Feb 2026. Closeout/permit-return paperwork pending.'
WHERE order_number = 'DEMO-025';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — Jobs (25, one per order)
-- ─────────────────────────────────────────────────────────────────────────────

-- template_id is NOT NULL on jobs. Resolved via scalar subquery against
-- milestone_templates filtered to the active new_stone template — same
-- template the seed reads in Step 5 for the milestone snapshot, so the
-- job's template_id and its snapshotted milestones come from the same
-- template version. No hardcoded UUID required; portable across environments.

INSERT INTO jobs (
  id, tenant_id, order_id, job_type, template_id,
  overall_status, last_update_at, created_at
)
SELECT
  CASE o.order_number
    WHEN 'DEMO-001' THEN 'd0000000-0000-4000-8000-000000000001'::uuid
    WHEN 'DEMO-002' THEN 'd0000000-0000-4000-8000-000000000002'::uuid
    WHEN 'DEMO-003' THEN 'd0000000-0000-4000-8000-000000000003'::uuid
    WHEN 'DEMO-004' THEN 'd0000000-0000-4000-8000-000000000004'::uuid
    WHEN 'DEMO-005' THEN 'd0000000-0000-4000-8000-000000000005'::uuid
    WHEN 'DEMO-006' THEN 'd0000000-0000-4000-8000-000000000006'::uuid
    WHEN 'DEMO-007' THEN 'd0000000-0000-4000-8000-000000000007'::uuid
    WHEN 'DEMO-008' THEN 'd0000000-0000-4000-8000-000000000008'::uuid
    WHEN 'DEMO-009' THEN 'd0000000-0000-4000-8000-000000000009'::uuid
    WHEN 'DEMO-010' THEN 'd0000000-0000-4000-8000-000000000010'::uuid
    WHEN 'DEMO-011' THEN 'd0000000-0000-4000-8000-000000000011'::uuid
    WHEN 'DEMO-012' THEN 'd0000000-0000-4000-8000-000000000012'::uuid
    WHEN 'DEMO-013' THEN 'd0000000-0000-4000-8000-000000000013'::uuid
    WHEN 'DEMO-014' THEN 'd0000000-0000-4000-8000-000000000014'::uuid
    WHEN 'DEMO-015' THEN 'd0000000-0000-4000-8000-000000000015'::uuid
    WHEN 'DEMO-016' THEN 'd0000000-0000-4000-8000-000000000016'::uuid
    WHEN 'DEMO-017' THEN 'd0000000-0000-4000-8000-000000000017'::uuid
    WHEN 'DEMO-018' THEN 'd0000000-0000-4000-8000-000000000018'::uuid
    WHEN 'DEMO-019' THEN 'd0000000-0000-4000-8000-000000000019'::uuid
    WHEN 'DEMO-020' THEN 'd0000000-0000-4000-8000-000000000020'::uuid
    WHEN 'DEMO-021' THEN 'd0000000-0000-4000-8000-000000000021'::uuid
    WHEN 'DEMO-022' THEN 'd0000000-0000-4000-8000-000000000022'::uuid
    WHEN 'DEMO-023' THEN 'd0000000-0000-4000-8000-000000000023'::uuid
    WHEN 'DEMO-024' THEN 'd0000000-0000-4000-8000-000000000024'::uuid
    WHEN 'DEMO-025' THEN 'd0000000-0000-4000-8000-000000000025'::uuid
  END,
  o.tenant_id,
  o.id,
  'new_stone',
  (
    SELECT id
    FROM milestone_templates
    WHERE job_type = 'new_stone'
      AND is_active = true
    LIMIT 1
  ),
  'active',
  o.created_at,
  o.created_at
FROM orders o
WHERE LEFT(o.order_number, 5) = 'DEMO-'
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — Snapshot template milestones for each job
-- ─────────────────────────────────────────────────────────────────────────────

-- Schema-grounded INSERT column list. Per the inspection on 2026-05-21,
-- job_milestones does NOT have a created_at column — only updated_at.
-- Writing created_at would error with "column ... does not exist".
-- All other required columns (job_id, milestone_key, label, group) are
-- present and populated below.
INSERT INTO job_milestones (
  id, tenant_id, job_id, milestone_key, label, "group", team,
  requires, cascades_to, is_decision, status, sort_order,
  updated_at
)
SELECT
  gen_random_uuid(),
  j.tenant_id,
  j.id,
  m->>'key',
  m->>'label',
  m->>'group',
  m->>'team',
  COALESCE(m->'requires', '[]'::jsonb),
  COALESCE(m->'cascades_to', '[]'::jsonb),
  COALESCE((m->>'is_decision')::boolean, false),
  'not_started',
  COALESCE((m->>'sort_order')::int, 0),
  j.created_at
FROM jobs j
JOIN milestone_templates t
  ON t.job_type = j.job_type AND t.is_active = true
CROSS JOIN LATERAL jsonb_array_elements(t.template->'milestones') AS m
WHERE LEFT(
  (SELECT order_number FROM orders WHERE orders.id = j.order_id),
  5
) = 'DEMO-'
  AND NOT EXISTS (
    SELECT 1 FROM job_milestones jm
    WHERE jm.job_id = j.id AND jm.milestone_key = m->>'key'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6 — Per-scenario milestone state updates
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Scenarios 1, 2, 3 (Layouts: Needs layout drawing) ─────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '2 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000001'
  AND milestone_key IN ('intake_complete', 'design_needed');

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000002'
  AND milestone_key IN ('intake_complete', 'design_needed');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '3 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000002'
  AND milestone_key = 'proof_created';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '6 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000003'
  AND milestone_key IN ('intake_complete', 'design_needed');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '4 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000003'
  AND milestone_key = 'proof_created';

-- ─── Scenarios 4, 5, 6, 21 (Layouts: Awaiting customer approval) ───────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '7 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000004'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '3 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000004'
  AND milestone_key = 'proof_sent';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '13 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000005'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '9 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000005'
  AND milestone_key = 'proof_sent';
UPDATE jobs SET overall_status = 'waiting_on_customer', last_update_at = now() - interval '9 days'
WHERE id = 'd0000000-0000-4000-8000-000000000005';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '20 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000006'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '16 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000006'
  AND milestone_key = 'proof_sent';
UPDATE jobs SET overall_status = 'waiting_on_customer', last_update_at = now() - interval '16 days'
WHERE id = 'd0000000-0000-4000-8000-000000000006';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '10 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000021'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '6 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000021'
  AND milestone_key = 'proof_sent';
UPDATE jobs SET overall_status = 'waiting_on_customer', last_update_at = now() - interval '6 days'
WHERE id = 'd0000000-0000-4000-8000-000000000021';

-- ─── Scenarios 7, 8, 22 (Layouts: Approved, ready to advance) ──────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '15 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000007'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '12 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000008'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '20 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000022'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');

-- ─── Scenarios 9, 10 (Stones: To order) ────────────────────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '22 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000009'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '27 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000010'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');

-- ─── Scenarios 11, 12, 13, 23 (Stones: Ordered awaiting supplier) ──────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '25 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000011'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '2 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000011'
  AND milestone_key = 'stone_ordered';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '30 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000012'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '14 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000012'
  AND milestone_key = 'stone_ordered';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '40 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000013'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');
UPDATE job_milestones SET status = 'in_progress',
                          updated_at = now() - interval '10 days',
                          due_date = current_date - 3
WHERE job_id = 'd0000000-0000-4000-8000-000000000013'
  AND milestone_key = 'stone_ordered';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '45 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000023'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '20 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000023'
  AND milestone_key = 'stone_ordered';

-- ─── Scenario 14 (Stones: Received / awaiting production) ─────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '50 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000014'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered');
UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000014'
  AND milestone_key = 'stone_received';

-- ─── Scenarios 15, 16 (Production: Stencil prep needed) ────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '55 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000015'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '4 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000015'
  AND milestone_key = 'stencil_created';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '60 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000016'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created');

-- ─── Scenario 17 (Production: Ready for carving) ──────────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '65 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000017'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut');

-- ─── Scenarios 18, 19 (Production: In production) ─────────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '70 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000018'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '8 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000018'
  AND milestone_key = 'production_started';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '75 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000019'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started');

-- ─── Scenario 20 (Production: Complete / awaiting install) ────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '80 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000020'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed', 'foundation_poured');

-- ─── Scenarios 24, 25 ─────────────────────────────────────────────────────

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '78 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000024'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000024'
  AND milestone_key = 'production_started';

UPDATE job_milestones SET status = 'done', updated_at = now() - interval '100 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000025'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed', 'foundation_poured', 'ready_to_install', 'installed');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6.5 — Scheduler workflow-column demo: park 4 jobs at mapped, actionable
-- milestone stages so the Scheduler bottom-grid columns populate.
-- ─────────────────────────────────────────────────────────────────────────────
-- getSchedulableJobs buckets a job by an ACTIONABLE milestone on one of four
-- mapped keys: ready_to_install → setting (new_stone), foundation_poured →
-- foundation_trip, production_started → blasting, stencil_cut → inscription
-- (inscription job_type only). Setting the target key to 'in_progress' makes it
-- actionable regardless of requires; predecessors are 'done' and successors
-- 'not_started', so each job parks in exactly ONE column (no double-bucketing).
-- These 4 jobs are also left UNBATCHED (their work_batch_jobs links are removed
-- in demo_seed_scheduler.sql) so the deriver's "already-batched" gate doesn't
-- hide them. All demo jobs are new_stone, so the delivery column (non-new_stone
-- ready_to_install) is intentionally not demonstrated.

-- DEMO-023 → SETTING-ready (ready_to_install actionable, new_stone)
UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000023'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed', 'foundation_poured');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000023' AND milestone_key = 'ready_to_install';
UPDATE job_milestones SET status = 'not_started', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000023' AND milestone_key = 'installed';

-- DEMO-018 → SETTING-ready (ready_to_install actionable, new_stone)
UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000018'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed', 'foundation_poured');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000018' AND milestone_key = 'ready_to_install';
UPDATE job_milestones SET status = 'not_started', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000018' AND milestone_key = 'installed';

-- DEMO-021 → FOUNDATION_TRIP-ready (foundation_poured actionable)
UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000021'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut', 'production_started', 'production_completed');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000021' AND milestone_key = 'foundation_poured';
UPDATE job_milestones SET status = 'not_started', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000021' AND milestone_key IN ('ready_to_install', 'installed');

-- DEMO-013 → BLASTING-ready (production_started actionable)
UPDATE job_milestones SET status = 'done', updated_at = now() - interval '5 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000013'
  AND milestone_key IN ('intake_complete', 'design_needed', 'proof_created', 'proof_sent', 'proof_approved', 'stone_ordered', 'stone_received', 'stencil_created', 'stencil_cut');
UPDATE job_milestones SET status = 'in_progress', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000013' AND milestone_key = 'production_started';
UPDATE job_milestones SET status = 'not_started', updated_at = now() - interval '1 days'
WHERE job_id = 'd0000000-0000-4000-8000-000000000013' AND milestone_key IN ('production_completed', 'foundation_poured', 'ready_to_install', 'installed');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7 — Per-scenario payment seeding (amounts derived from pricing.grandTotal)
-- ─────────────────────────────────────────────────────────────────────────────
-- Payment shape per M2:
--   { id, amount, method, ref, receivedAt, createdAt, createdBy, note, voided, locked }
-- Each UPDATE also merges payment-derived fields back into pricing JSONB so
-- pricing.paymentStatus and pricing.balanceRemaining stay consistent with
-- the payments[] array. Realism UPDATEs (Step 3.5) seeded the unpaid default.

-- Partial — 50% deposit, balance outstanding.
UPDATE orders SET
  payments = jsonb_build_array(
    jsonb_build_object(
      'id',         '11111111-1111-4111-8111-100000000000',
      'amount',     ROUND((pricing->>'grandTotal')::numeric / 2, 2),
      'method',     'check',
      'ref',        '4001',
      'receivedAt', (current_date - 8)::text,
      'createdAt',  (now() - interval '8 days')::text,
      'createdBy',  'ZZ_DEMO_Sales',
      'note',       NULL,
      'voided',     false,
      'locked',     true
    )
  ),
  pricing = pricing || jsonb_build_object(
    'paymentStatus',    'partial',
    'balanceRemaining', (pricing->>'grandTotal')::numeric - ROUND((pricing->>'grandTotal')::numeric / 2, 2)
  )
WHERE order_number IN ('DEMO-004', 'DEMO-005', 'DEMO-007', 'DEMO-011', 'DEMO-014',
                       'DEMO-015', 'DEMO-018', 'DEMO-021', 'DEMO-022', 'DEMO-023');

-- Paid in full — deposit + final balance totaling pricing.grandTotal.
UPDATE orders SET
  payments = jsonb_build_array(
    jsonb_build_object(
      'id',         '22222222-2222-4222-8222-200000000001',
      'amount',     ROUND((pricing->>'grandTotal')::numeric / 2, 2),
      'method',     'check',
      'ref',        '5001',
      'receivedAt', (current_date - 90)::text,
      'createdAt',  (now() - interval '90 days')::text,
      'createdBy',  'ZZ_DEMO_Sales',
      'note',       NULL,
      'voided',     false,
      'locked',     true
    ),
    jsonb_build_object(
      'id',         '22222222-2222-4222-8222-200000000002',
      'amount',     (pricing->>'grandTotal')::numeric - ROUND((pricing->>'grandTotal')::numeric / 2, 2),
      'method',     'check',
      'ref',        '5002',
      'receivedAt', (current_date - 20)::text,
      'createdAt',  (now() - interval '20 days')::text,
      'createdBy',  'ZZ_DEMO_Sales',
      'note',       NULL,
      'voided',     false,
      'locked',     true
    )
  ),
  pricing = pricing || jsonb_build_object(
    'paymentStatus',    'paid_in_full',
    'balanceRemaining', 0
  )
WHERE order_number IN ('DEMO-008', 'DEMO-017', 'DEMO-019', 'DEMO-020', 'DEMO-024', 'DEMO-025');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8 — Verification SELECTs
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'SEEDED — customers'    AS phase, COUNT(*) AS rows_inserted
FROM customers WHERE LEFT(last_name, 8) = 'ZZ_DEMO_';

SELECT 'SEEDED — cemeteries'   AS phase, COUNT(*) AS rows_inserted
FROM cemeteries WHERE LEFT(name, 8) = 'ZZ_DEMO_';

SELECT 'SEEDED — orders'       AS phase, COUNT(*) AS rows_inserted
FROM orders WHERE LEFT(order_number, 5) = 'DEMO-';

SELECT 'SEEDED — jobs'         AS phase, COUNT(*) AS rows_inserted
FROM jobs WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

SELECT 'SEEDED — job_milestones' AS phase, COUNT(*) AS rows_inserted
FROM job_milestones WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

-- Operational snapshot per scenario — milestone state distribution + monument profile.
-- Pricing fields extracted from the pricing JSONB column (no scalar pricing
-- columns exist on orders — verified 2026-05-21).
SELECT
  o.order_number,
  o.granite_color,
  o.shape,
  o.shape_subtype,
  (o.pricing->>'grandTotal')::numeric                  AS grand_total,
  o.pricing->>'paymentStatus'                          AS payment_status,
  (o.pricing->>'balanceRemaining')::numeric            AS balance_remaining,
  COUNT(jm.*) FILTER (WHERE jm.status = 'done')        AS done_count,
  COUNT(jm.*) FILTER (WHERE jm.status = 'in_progress') AS in_progress_count,
  COUNT(jm.*) FILTER (WHERE jm.status = 'not_started') AS not_started_count,
  j.overall_status                                     AS job_status,
  jsonb_array_length(o.payments)                       AS payment_count,
  CASE
    WHEN jsonb_array_length(o.payments) = 0 THEN 'unpaid'
    WHEN (SELECT SUM((p->>'amount')::numeric) FROM jsonb_array_elements(o.payments) p)
         >= (o.pricing->>'grandTotal')::numeric THEN 'paid_in_full'
    ELSE 'partial'
  END                                                  AS payment_state_derived
FROM orders o
JOIN jobs j ON j.order_id = o.id
LEFT JOIN job_milestones jm ON jm.job_id = j.id
WHERE LEFT(o.order_number, 5) = 'DEMO-'
GROUP BY o.order_number, o.granite_color, o.shape, o.shape_subtype, o.pricing, j.overall_status, o.payments
ORDER BY o.order_number;

COMMIT;
