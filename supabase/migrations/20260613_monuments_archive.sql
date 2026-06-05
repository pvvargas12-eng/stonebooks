-- =============================================================================
-- 20260613_monuments_archive.sql
-- Catalog archive: soft-archive designs instead of deleting, plus the staff
-- write permissions the archive flow needs.
--
-- - Adds monuments.is_archived (boolean, default false).
-- - Grants STAFF (is_staff()) UPDATE and DELETE on monuments; partners excluded.
--   Permissive policies keyed on is_staff() already exclude partners (a partner
--   has no granting policy), consistent with the lockdown; the 20260610
--   zz_partner_lockdown RESTRICTIVE policy (if applied) is additional belt-and-
--   suspenders. SELECT stays as-is (monuments_public_read for authenticated).
-- - is_staff() and the DELETE policy are (re)created idempotently so this file is
--   self-contained even if 20260610 / 20260612 weren't run.
--
-- Safety: there is NO foreign key from orders/jobs to monuments (orders keep
-- their own designs[0].snapshot JSONB), so archiving/deleting a catalog row
-- never affects an order.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: supabase/backups/2026-06-05_monuments_archive_rollback.sql
-- =============================================================================

-- 1. Soft-archive flag.
alter table public.monuments
  add column if not exists is_archived boolean not null default false;

-- 2. is_staff() — same definition as 20260610 (idempotent).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

-- 3. Staff UPDATE (archive / restore) — partners have no granting policy → blocked.
drop policy if exists monuments_staff_update on public.monuments;
create policy monuments_staff_update on public.monuments
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- 4. Staff DELETE (permanent purge from the archive) — keep / ensure it exists.
drop policy if exists monuments_staff_delete on public.monuments;
create policy monuments_staff_delete on public.monuments
  for delete to authenticated using (public.is_staff());

-- =============================================================================
-- VERIFY (run after applying):
--   • As STAFF (authenticated, not a partner):
--       update public.monuments set is_archived = true  where id = '<some id>';  -- 1 row
--       update public.monuments set is_archived = false where id = '<some id>';  -- restores
--     select public.is_staff();  -- true
--   • As a PARTNER (portal user): the same UPDATE affects 0 rows / is denied,
--       and delete is denied. select public.is_staff();  -- false
-- =============================================================================
