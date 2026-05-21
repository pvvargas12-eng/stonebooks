-- =============================================================================
-- supabase/demo_cleanup.sql
-- Deletes all demo/test data from Stonebooks, identified by naming convention.
-- =============================================================================
--
-- Identifies demo rows ONLY by these exact literal prefixes:
--   customers.last_name    LEFT(...,8) = 'ZZ_DEMO_'  (literal — using LEFT, not LIKE)
--   cemeteries.name        LEFT(...,8) = 'ZZ_DEMO_'  (literal)
--   orders.order_number    LEFT(...,5) = 'DEMO-'     (literal)
--
-- LEFT(col, N) = '<prefix>' is used instead of LIKE 'prefix%' because the
-- underscore character is a single-char wildcard in LIKE. A LIKE pattern
-- like 'ZZ_DEMO_%' would also match "ZZADEMOXSmith" — too permissive.
-- LEFT() compares literal substrings — bullet-proof prefix matching.
--
-- =============================================================================
-- FK graph (verified 2026-05-21):
--   jobs.id            ← job_events.job_id         CASCADE
--   jobs.id            ← job_milestones.job_id     CASCADE
--   orders.id          ← jobs.order_id             RESTRICT  ← load-bearing order
--   orders.id          ← order_attachments.order_id CASCADE
--   orders.id          ← orders.parent_quote_id    SET NULL  ← defensive check
--   customers.id       ← orders.customer_id        SET NULL  ← defensive check
--   cemeteries.id      ← orders.cemetery_id        SET NULL  ← defensive check
--
-- Cleanup order (reverse dependency, with safety):
--   1. job_events           (explicit DELETE for transparency, CASCADE would also work)
--   2. job_milestones       (explicit DELETE for transparency, CASCADE would also work)
--   3. jobs                 (required before orders due to RESTRICT)
--   4. orders               (with defensive check: only delete demo orders not
--                            referenced by REAL orders' parent_quote_id; CASCADE
--                            handles order_attachments automatically)
--   5. customers            (defensive NOT EXISTS — only delete if no remaining
--                            orders reference them, prevents SET NULL on reals)
--   6. cemeteries           (defensive NOT EXISTS — same logic)
--
-- Safety guarantees:
--   • Real data is structurally untouchable: no real customer last_name starts
--     with "ZZ_DEMO_", no real cemetery name starts with "ZZ_DEMO_", no real
--     order_number starts with "DEMO-".
--   • SET NULL FKs protected: the NOT EXISTS / defensive checks on orders,
--     customers, and cemeteries ensure we never null a real order's FK by
--     accidentally cascading a demo-row delete.
--   • RESTRICT FK respected: jobs deleted before orders.
--   • Wrapped in BEGIN/COMMIT — partial cleanup cannot leave a half-deleted state.
--   • Pre-delete counts let you sanity-check before COMMIT.
--   • Post-delete counts confirm every demo row is gone (all should be zero).
--   • Idempotent — running multiple times is safe (DELETE on empty set is a no-op).
--
-- What this script does NOT do:
--   • It does NOT touch any row whose name/order_number doesn't start with the
--     exact literal prefix.
--   • It does NOT alter schema, drop tables, or touch any other table.
--   • It does NOT delete test data with different naming conventions. If you
--     have prior dev rows that don't follow ZZ_DEMO_ / DEMO- prefix, run a
--     separate one-off DELETE before this script.
--   • It does NOT explicitly DELETE from order_attachments (CASCADE handles
--     them automatically when their parent orders are deleted). The BEFORE
--     and AFTER counts confirm the cascade worked as expected.
--
-- Run ONCE in Supabase Studio SQL Editor whenever you want to wipe demo data.
-- Source-controlled at supabase/demo_cleanup.sql.

BEGIN;

-- ─── PRE-DELETE counts — what we're about to remove ──────────────────────────

SELECT
  'BEFORE — customers'     AS phase,
  COUNT(*)                 AS demo_rows
FROM customers
WHERE LEFT(last_name, 8) = 'ZZ_DEMO_';

SELECT
  'BEFORE — cemeteries'    AS phase,
  COUNT(*)                 AS demo_rows
FROM cemeteries
WHERE LEFT(name, 8) = 'ZZ_DEMO_';

SELECT
  'BEFORE — orders'        AS phase,
  COUNT(*)                 AS demo_rows
FROM orders
WHERE LEFT(order_number, 5) = 'DEMO-';

SELECT
  'BEFORE — order_attachments' AS phase,
  COUNT(*)                     AS demo_rows
FROM order_attachments
WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

SELECT
  'BEFORE — jobs'          AS phase,
  COUNT(*)                 AS demo_rows
FROM jobs
WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

SELECT
  'BEFORE — job_milestones' AS phase,
  COUNT(*)                  AS demo_rows
FROM job_milestones
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

SELECT
  'BEFORE — job_events'    AS phase,
  COUNT(*)                 AS demo_rows
FROM job_events
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

-- ─── DELETE — reverse FK order with defensive checks ─────────────────────────

-- 1. job_events  (CASCADE would handle this, but explicit DELETE gives
-- transparent before/after counts and makes the script self-documenting.)
DELETE FROM job_events
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

-- 2. job_milestones  (same — CASCADE would work; explicit for transparency.)
DELETE FROM job_milestones
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

-- 3. jobs  (REQUIRED before orders due to RESTRICT FK on jobs.order_id.)
DELETE FROM jobs
WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

-- 4. orders  (CASCADE handles order_attachments automatically.)
-- Defensive: orders.parent_quote_id is SET NULL on delete, so deleting a
-- demo order that's referenced by a REAL order's parent_quote_id would
-- silently null that real order's column. The NOT EXISTS check refuses
-- to delete demo orders that real orders depend on. In normal demo flow,
-- no such reference exists; this guard is here for defense in depth.
DELETE FROM orders
WHERE LEFT(order_number, 5) = 'DEMO-'
  AND NOT EXISTS (
    SELECT 1 FROM orders other
    WHERE other.parent_quote_id = orders.id
      AND LEFT(other.order_number, 5) <> 'DEMO-'
  );

-- 5. customers  (defensive: only delete if no remaining orders reference them.)
-- customers.id ← orders.customer_id is SET NULL on delete, so deleting a
-- demo customer that a real order still references would null that real
-- order's customer_id. The NOT EXISTS check refuses to delete demo
-- customers that any order (demo or real) still depends on.
DELETE FROM customers
WHERE LEFT(last_name, 8) = 'ZZ_DEMO_'
  AND NOT EXISTS (
    SELECT 1 FROM orders WHERE orders.customer_id = customers.id
  );

-- 6. cemeteries  (defensive: same logic.)
DELETE FROM cemeteries
WHERE LEFT(name, 8) = 'ZZ_DEMO_'
  AND NOT EXISTS (
    SELECT 1 FROM orders WHERE orders.cemetery_id = cemeteries.id
  );

-- ─── POST-DELETE counts — confirm zero remaining demo rows ───────────────────

SELECT
  'AFTER — customers'      AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM customers
WHERE LEFT(last_name, 8) = 'ZZ_DEMO_';

SELECT
  'AFTER — cemeteries'     AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM cemeteries
WHERE LEFT(name, 8) = 'ZZ_DEMO_';

SELECT
  'AFTER — orders'         AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM orders
WHERE LEFT(order_number, 5) = 'DEMO-';

SELECT
  'AFTER — order_attachments' AS phase,
  COUNT(*)                    AS demo_rows_remaining
FROM order_attachments
WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

SELECT
  'AFTER — jobs'           AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM jobs
WHERE order_id IN (
  SELECT id FROM orders WHERE LEFT(order_number, 5) = 'DEMO-'
);

SELECT
  'AFTER — job_milestones' AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM job_milestones
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

SELECT
  'AFTER — job_events'     AS phase,
  COUNT(*)                 AS demo_rows_remaining
FROM job_events
WHERE job_id IN (
  SELECT j.id FROM jobs j
  JOIN orders o ON o.id = j.order_id
  WHERE LEFT(o.order_number, 5) = 'DEMO-'
);

COMMIT;
