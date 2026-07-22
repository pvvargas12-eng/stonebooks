-- =============================================================================
-- CALENDAR REMINDERS (2026-07-22) — can't-miss, acknowledged-by-a-human
-- =============================================================================
-- Paul: "below the calendar i want a section for reminders something you cant
-- miss... multiple reminders if i wanted... day before few days before week
-- 2 weeks month 2 months... or an actual date... there should be an
-- acknowledge on those reminders." One row per firing: setting several
-- offsets on one event inserts several rows. A reminder stays on the board
-- until a person ACKNOWLEDGES it (stamped who + when).

CREATE TABLE IF NOT EXISTS calendar_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  remind_on date NOT NULL,
  event_date date,
  source_type text NOT NULL DEFAULT 'custom',   -- batch | task | order | custom
  source_id text,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);
CREATE INDEX IF NOT EXISTS calendar_reminders_due_idx
  ON calendar_reminders (remind_on) WHERE acknowledged_at IS NULL;

ALTER TABLE calendar_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_reminders_authenticated_all ON calendar_reminders;
CREATE POLICY calendar_reminders_authenticated_all ON calendar_reminders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS calendar_reminders_staff_only ON calendar_reminders;
CREATE POLICY calendar_reminders_staff_only ON calendar_reminders
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS calendar_reminders_anon_none ON calendar_reminders;
CREATE POLICY calendar_reminders_anon_none ON calendar_reminders
  AS RESTRICTIVE FOR ALL TO anon USING (false);
