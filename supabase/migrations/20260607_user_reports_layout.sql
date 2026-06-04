-- =============================================================================
-- 20260607_user_reports_layout.sql
-- REPORTS TAB — per-user layout (pinned / hidden / order). Adds a JSONB column
-- to the existing user_settings prefs store. Until applied, the Reports tab
-- persists layout to localStorage (survives reload, per-browser); once applied,
-- upsertUserSettings({ reports_layout }) makes it cross-device.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent — safe to re-run.
-- =============================================================================

alter table user_settings
  add column if not exists reports_layout jsonb;
