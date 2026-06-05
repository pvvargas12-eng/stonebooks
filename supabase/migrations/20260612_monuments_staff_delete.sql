-- =============================================================================
-- 20260612_monuments_staff_delete.sql
-- Catalog cleanup: allow STAFF to DELETE monuments (remove duplicate designs).
--
-- monuments has RLS enabled with ONLY a SELECT policy (monuments_public_read),
-- so authenticated staff currently cannot delete a row. This adds a staff-only
-- DELETE policy. is_staff() is (re)created idempotently with the SAME definition
-- as 20260610, so this migration is self-contained even if run on its own.
--
-- Safety verified before shipping: there is NO foreign key from orders (or jobs)
-- to monuments — orders keep their own designs[0].snapshot JSONB, so deleting a
-- catalog row cannot block the delete or cascade-delete an order.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: drop policy monuments_staff_delete on public.monuments;
-- =============================================================================

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

drop policy if exists monuments_staff_delete on public.monuments;
create policy monuments_staff_delete on public.monuments
  for delete to authenticated using (public.is_staff());

-- VERIFY (run as staff in the app, or here as service-role): a staff session can
--   delete public.monuments where id = '<some id>';  -- succeeds
-- A partner session is blocked (is_staff() = false). Anon is already blocked.
