-- =============================================================================
-- CEMETERY HUB (2026-07-22) — drive link, manual location pin, labeled map pages
-- =============================================================================
-- Paul: a Cemeteries tab with every cemetery's info, a Google Drive link, a
-- location PIN for the ones Google can't find, and quick bulk upload of the
-- paper map pages (some cemeteries run 60+ sheets) with a label per picture.
-- The field app reads the same rows: GO TO directions off the pin, the map
-- pages on the phone, and marking the pin from on-site GPS.

ALTER TABLE cemeteries ADD COLUMN IF NOT EXISTS drive_link text;
ALTER TABLE cemeteries ADD COLUMN IF NOT EXISTS pin_lat numeric;
ALTER TABLE cemeteries ADD COLUMN IF NOT EXISTS pin_lng numeric;
ALTER TABLE cemeteries ADD COLUMN IF NOT EXISTS pin_set_by text;
ALTER TABLE cemeteries ADD COLUMN IF NOT EXISTS pin_set_at timestamptz;

CREATE TABLE IF NOT EXISTS cemetery_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cemetery_id uuid NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  storage_path text,
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cemetery_maps_cemetery_idx
  ON cemetery_maps (cemetery_id, sort_order, created_at);

-- Three-role parity (house pattern): staff full CRUD, partners excluded via
-- the restrictive is_staff() gate, anon nothing.
ALTER TABLE cemetery_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cemetery_maps_authenticated_all ON cemetery_maps;
CREATE POLICY cemetery_maps_authenticated_all ON cemetery_maps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cemetery_maps_staff_only ON cemetery_maps;
CREATE POLICY cemetery_maps_staff_only ON cemetery_maps
  AS RESTRICTIVE FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY IF EXISTS cemetery_maps_anon_none ON cemetery_maps;
CREATE POLICY cemetery_maps_anon_none ON cemetery_maps
  AS RESTRICTIVE FOR ALL TO anon USING (false);
