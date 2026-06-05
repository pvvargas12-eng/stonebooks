-- =============================================================================
-- ROLLBACK for 20260613_monuments_archive.sql
-- Removes the staff UPDATE policy and the is_archived column. Leaves the staff
-- DELETE policy (it predates this migration, from 20260612) and is_staff() in
-- place. Run in Supabase Studio. Idempotent.
--
-- NOTE: dropping is_archived discards which designs were archived. If you only
-- want to disable the feature, drop the UPDATE policy and keep the column.
-- =============================================================================

drop policy if exists monuments_staff_update on public.monuments;

alter table public.monuments drop column if exists is_archived;

-- To also remove the permanent-delete permission added alongside this feature:
--   drop policy if exists monuments_staff_delete on public.monuments;
-- (Left in place by default — it was introduced in 20260612.)
