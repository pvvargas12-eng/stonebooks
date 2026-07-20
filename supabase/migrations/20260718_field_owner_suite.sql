-- =============================================================================
-- FIELD-3 (2026-07-18) — owner suite: person PINs, notifications, web push
-- =============================================================================
-- 1. employees.pin — optional 4-digit code asked at the /field person picker.
--    Closes the "worker taps Paul" hole until real per-person logins land.
-- 2. notifications — the in-app feed (bell) per person. Audience decided at
--    INSERT: money/approval rows are only ever written for owner names.
-- 3. push_subscriptions — one row per device that granted Web Push.
-- Applied to prod via the Management API on 2026-07-18.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS pin text;

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  employee_name text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  deep_link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_employee_created_idx
  ON notifications (employee_name, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  employee_name text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device_label text,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Three-role RLS parity (authenticated-all + restrictive staff + anon false),
-- matching every FIELD/TASK-era table.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_authenticated_all ON notifications;
CREATE POLICY notifications_authenticated_all ON notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS notifications_staff_only ON notifications;
CREATE POLICY notifications_staff_only ON notifications
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS notifications_anon_none ON notifications;
CREATE POLICY notifications_anon_none ON notifications
  AS RESTRICTIVE FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS push_subscriptions_authenticated_all ON push_subscriptions;
CREATE POLICY push_subscriptions_authenticated_all ON push_subscriptions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS push_subscriptions_staff_only ON push_subscriptions;
CREATE POLICY push_subscriptions_staff_only ON push_subscriptions
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS push_subscriptions_anon_none ON push_subscriptions;
CREATE POLICY push_subscriptions_anon_none ON push_subscriptions
  AS RESTRICTIVE FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS push_state_authenticated_all ON push_state;
CREATE POLICY push_state_authenticated_all ON push_state
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS push_state_staff_only ON push_state;
CREATE POLICY push_state_staff_only ON push_state
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS push_state_anon_none ON push_state;
CREATE POLICY push_state_anon_none ON push_state
  AS RESTRICTIVE FOR ALL TO anon USING (false);
