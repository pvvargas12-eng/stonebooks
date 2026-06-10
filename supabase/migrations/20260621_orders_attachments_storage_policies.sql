-- =============================================================================
-- 20260621_orders_attachments_storage_policies.sql
-- Staff write/list access to the orders-attachments-public storage bucket.
-- =============================================================================
-- Symptom: uploads to orders-attachments-public fail with
--   "new row violates row-level security policy"
-- and the public URL then 400s (the object never landed). This bucket is the
-- SINGLE write target for ALL order file paths — auto-captured estimate/contract
-- PDFs (#2), manual attachment uploads (uploadOrderAttachment), and completion
-- photos — so one policy set repairs every path.
--
-- Scope is as tight as it should be: THIS bucket only, STAFF only. is_staff()
-- excludes partners and anon. Public DOWNLOADS are served by the bucket's
-- `public` flag and are NOT governed by these policies (RLS on storage.objects
-- gates the write/list API, not public-URL fetches). list()/select still needs
-- a SELECT policy, included below.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent — safe to re-run.
-- =============================================================================

-- is_staff() — same definition used across the app's lockdown (idempotent).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

-- Ensure the bucket exists and stays public (download URLs).
insert into storage.buckets (id, name, public)
values ('orders-attachments-public', 'orders-attachments-public', true)
on conflict (id) do update set public = true;

-- Replace any prior/partial policies for this bucket with a clean staff set.
drop policy if exists "Authenticated uploads to orders-attachments-public" on storage.objects;
drop policy if exists "Authenticated updates in orders-attachments-public" on storage.objects;
drop policy if exists "Authenticated deletes in orders-attachments-public" on storage.objects;
drop policy if exists oap_staff_select on storage.objects;
drop policy if exists oap_staff_insert on storage.objects;
drop policy if exists oap_staff_update on storage.objects;
drop policy if exists oap_staff_delete on storage.objects;

create policy oap_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'orders-attachments-public' and public.is_staff());

create policy oap_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'orders-attachments-public' and public.is_staff());

create policy oap_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'orders-attachments-public' and public.is_staff())
  with check (bucket_id = 'orders-attachments-public' and public.is_staff());

create policy oap_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'orders-attachments-public' and public.is_staff());

-- =============================================================================
-- VERIFY (run as a staff/authenticated session, not the SQL editor's service role
-- if you want a true RLS test — or just retry an upload in the app):
--   select public.is_staff();   -- expect: t  (for a signed-in staff user)
--   select policyname, cmd from pg_policies
--     where schemaname='storage' and tablename='objects'
--       and policyname like 'oap_staff_%';   -- expect 4 rows
-- Then in the app: open an order, regenerate the estimate PDF — the
-- "new row violates RLS" error should be gone and "Estimate (current).pdf"
-- should appear in the attachments list.
-- =============================================================================
