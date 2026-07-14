-- =============================================================================
-- 20260714_retemplate_stash.sql — jobs.retemplate_stash
-- =============================================================================
-- Audit A4: changing an order's job type re-templates the checklist and
-- resets type-specific progress. When the type is toggled away and back
-- (wizard Step-1 multi-select passing through intermediate types), that
-- progress was permanently lost. The stash keeps, per prior job_type, the
-- non-default milestone statuses at the moment of each re-template:
--   { "<job_type>": { savedAt, statuses: { "<key>": {status,status_date,note,due_date} } } }
-- Returning to a stashed type restores those statuses and consumes the entry.
-- Inherits jobs RLS. Idempotent — safe to re-run.
-- =============================================================================

alter table public.jobs add column if not exists retemplate_stash jsonb;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='jobs' and column_name='retemplate_stash';
