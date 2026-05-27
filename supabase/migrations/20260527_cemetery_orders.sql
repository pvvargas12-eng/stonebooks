-- Cemetery Orders — door orders placed BY cemeteries (distinct from family sales)
-- =============================================================================
-- A cemetery order is door/panel work ordered by a cemetery (the cemetery is the
-- "customer"), not a family memorial sale. It lives in its own table, separate
-- from `orders`. One row per order; `doors` (jsonb) holds the per-door spec
-- (location, selected priced items / custom line items, inscription text, notes).
-- On "Submit to production" the order spawns one job per door — those jobs link
-- back here via jobs.cemetery_order_id (added below), NOT jobs.order_id.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent (IF NOT EXISTS / DROP-then-
-- CREATE on policy + check). Safe to re-run.
-- =============================================================================

-- ── PART 1: cemetery_orders table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cemetery_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  order_number          text UNIQUE,                 -- 'CO-2026-001', generated on submit
  cemetery_name         text NOT NULL,               -- denormalized; matches a CEMETERY_DOOR_PRICING key via lookup
  cemetery_contact_name  text,
  cemetery_contact_email text,
  cemetery_contact_phone text,
  doors                 jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ location, selectedItems, customLineItems, inscriptionText, notes }]
  packet_storage_path   text,                        -- Supabase Storage path to the uploaded packet
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','in_production','completed','cancelled','invoiced','paid')),
  submitted_at          timestamptz,                 -- set when 'Submit to production' is clicked
  total_amount          numeric(10,2),               -- snapshot of the computed PO total at submit
  staff_notes           jsonb DEFAULT '[]'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid                          -- nullable; loosely references auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cemetery_orders_tenant        ON cemetery_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cemetery_orders_cemetery_name ON cemetery_orders(cemetery_name);

COMMENT ON TABLE cemetery_orders IS
  'Door/panel orders placed by a cemetery (the cemetery is the customer), distinct from family-sale orders in the orders table. One row per order; doors[] holds per-door spec. On submit, spawns one mausoleum_door job per door linked via jobs.cemetery_order_id.';

-- RLS — staff-internal: any authenticated user has full CRUD (mirrors the
-- scheduler tables' posture). No anon access.
ALTER TABLE cemetery_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cemetery_orders_authenticated_all ON cemetery_orders;
CREATE POLICY cemetery_orders_authenticated_all
  ON cemetery_orders
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── PART 2: jobs → cemetery_orders link ─────────────────────────────────────
-- A job belongs to EITHER a family order (order_id) OR a cemetery order
-- (cemetery_order_id), never both. order_id becomes nullable; a XOR CHECK
-- enforces exactly one. Existing jobs all have order_id set + cemetery_order_id
-- null, so they satisfy the new CHECK with no backfill needed.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS cemetery_order_id uuid REFERENCES cemetery_orders(id) ON DELETE RESTRICT;

ALTER TABLE jobs
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_order_or_cemetery_order;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_order_or_cemetery_order CHECK (
    (order_id IS NOT NULL AND cemetery_order_id IS NULL) OR
    (order_id IS NULL AND cemetery_order_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_jobs_cemetery_order_id ON jobs(cemetery_order_id);

COMMENT ON COLUMN jobs.cemetery_order_id IS
  'Parent cemetery_order for a door job (mutually exclusive with order_id — see jobs_order_or_cemetery_order). NULL for family-sale jobs.';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   -- table + RLS on:
--   select tablename, rowsecurity from pg_tables where tablename = 'cemetery_orders';
--   select policyname, cmd, roles from pg_policies where tablename = 'cemetery_orders';
--   -- jobs columns: cemetery_order_id present, order_id now nullable:
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'jobs' and column_name in ('order_id','cemetery_order_id') order by 1;
--   -- FK + XOR check definitions:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'jobs'::regclass
--      and conname in ('jobs_cemetery_order_id_fkey','jobs_order_or_cemetery_order');
