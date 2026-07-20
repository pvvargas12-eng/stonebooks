-- =============================================================================
-- 20260720_field_tabs.sql — per-person bottom-tab layout for /field (FIELD-7)
-- =============================================================================
-- Paul: "I need the ability to customize the tabs you want at the bottom,
-- then the rest go into More... they should each have their individual link
-- so they can make it custom to them." The person's chosen tab keys live on
-- their employees row (their private link pins the person, so the layout
-- follows them to any phone). NULL = role default (owner bar / production
-- bar / crew bar — resolved in the app). Validated client-side against the
-- tab registry on read AND write.
-- Idempotent — safe to re-run.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS field_tabs jsonb;

-- ── VERIFY ──
-- select column_name from information_schema.columns
--   where table_name='employees' and column_name='field_tabs';
