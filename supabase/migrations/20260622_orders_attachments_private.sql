-- =============================================================================
-- 20260622_orders_attachments_private.sql
-- PRIVATE bucket for signed contracts (5A.3: signed PDFs are never public).
-- =============================================================================
-- Signed contracts must NOT live in the public bucket. They go in
-- orders-attachments-private under <order_id>/contract-signed.pdf and are served
-- ONLY via short-lived signed URLs (createSignedUrl). Staff-only, same is_staff()
-- posture as 20260621. Draft estimates/contracts and ordinary attachments stay
-- in the public bucket.
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

-- Private bucket (public = false → no public URLs; signed URLs only).
insert into storage.buckets (id, name, public)
values ('orders-attachments-private', 'orders-attachments-private', false)
on conflict (id) do update set public = false;

drop policy if exists oapriv_staff_select on storage.objects;
drop policy if exists oapriv_staff_insert on storage.objects;
drop policy if exists oapriv_staff_update on storage.objects;
drop policy if exists oapriv_staff_delete on storage.objects;

create policy oapriv_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'orders-attachments-private' and public.is_staff());

create policy oapriv_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'orders-attachments-private' and public.is_staff());

create policy oapriv_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'orders-attachments-private' and public.is_staff())
  with check (bucket_id = 'orders-attachments-private' and public.is_staff());

create policy oapriv_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'orders-attachments-private' and public.is_staff());

-- =============================================================================
-- VERIFY:
--   select id, public from storage.buckets where id = 'orders-attachments-private';  -- public = f
--   select policyname, cmd from pg_policies
--     where schemaname='storage' and tablename='objects' and policyname like 'oapriv_%';  -- 4 rows
-- Then in the app: mark a contract signed; it should upload, pin, and preview via
-- a signed URL — and the public bucket must NOT contain the signed copy.
-- =============================================================================
