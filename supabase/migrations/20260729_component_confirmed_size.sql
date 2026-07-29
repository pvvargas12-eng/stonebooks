-- FIELD-FDN-CUT (2026-07-29): confirmed cut size, measured on the line.
-- Paul: "when it says brought to the line there must be a field to confirm
-- size for the cutter... i measure the length and width and in cut list the
-- confirmed sizes would show up because the cutter has to adjust the size to
-- whats actually cut — its normally off an inch or so."
-- Stored on the COMPONENT (the physical piece that got measured):
--   { "l": "36", "w": "8", "by": "Paul", "at": "2026-07-29T..." }
-- NULL = not confirmed. Inches as typed (fractions/decimals welcome).
alter table job_components add column if not exists confirmed_size jsonb;
