-- =============================================================================
-- CEMETERY MAP PINS (2026-07-22) — a grave pin on a map page, tied to an order
-- =============================================================================
-- Paul: "grave pins on the map would be awesome and then that would clear when
-- the order is closed out." Pins live on a map PAGE at a fractional x/y; each
-- pin belongs to an ORDER. Visibility is read-time: the app hides pins whose
-- order is closed/cancelled/archived, so closing an order clears its pin
-- everywhere (and reopening brings it back). Hard-deleting an order CASCADEs
-- its pins away. cemetery_id is denormalized for one-query reads per cemetery.

CREATE TABLE IF NOT EXISTS cemetery_map_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cemetery_id uuid NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
  map_id uuid NOT NULL REFERENCES cemetery_maps(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  x numeric NOT NULL,
  y numeric NOT NULL,
  label text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cemetery_map_pins_cemetery_idx ON cemetery_map_pins (cemetery_id);
CREATE INDEX IF NOT EXISTS cemetery_map_pins_map_idx ON cemetery_map_pins (map_id);
CREATE INDEX IF NOT EXISTS cemetery_map_pins_order_idx ON cemetery_map_pins (order_id);

ALTER TABLE cemetery_map_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cemetery_map_pins_authenticated_all ON cemetery_map_pins;
CREATE POLICY cemetery_map_pins_authenticated_all ON cemetery_map_pins
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cemetery_map_pins_staff_only ON cemetery_map_pins;
CREATE POLICY cemetery_map_pins_staff_only ON cemetery_map_pins
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS cemetery_map_pins_anon_none ON cemetery_map_pins;
CREATE POLICY cemetery_map_pins_anon_none ON cemetery_map_pins
  AS RESTRICTIVE FOR ALL TO anon USING (false);
