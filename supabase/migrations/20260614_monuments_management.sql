-- =============================================================================
-- 20260614_monuments_management.sql
-- Catalog management: a public image bucket for new catalog photos + a staff
-- INSERT policy on monuments so staff can add designs.
--
-- - Storage bucket `monument-images`: PUBLIC read. These are product/catalog
--   photos (already public on the old site via Google Drive), not customer data,
--   and the gallery <img> must load them without auth. Writes (insert/update/
--   delete) are staff-only via is_staff(); partners are excluded (no granting
--   policy for them, and the 20260610 zz_partner_lockdown_storage RESTRICTIVE
--   already narrows authenticated partners to vendor-files).
-- - monuments: staff INSERT policy (is_staff(), partners excluded). UPDATE comes
--   from 20260613, DELETE from 20260612 (both re-created here idempotently so the
--   file is self-contained).
--
-- New uploads write the Supabase public URL into monuments.img (same text column
-- the gallery already reads — Drive URLs render alongside Supabase URLs; the
-- gallery's drive.google.com rewrite simply passes non-Drive URLs through).
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: supabase/backups/2026-06-05_monuments_management_rollback.sql
-- =============================================================================

-- is_staff() — same definition as 20260610 (idempotent).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

-- ── Public bucket for catalog photos ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('monument-images', 'monument-images', true)
on conflict (id) do update set public = true;

do $$ begin
  -- Public read (catalog photos load without auth; also covered by the public
  -- bucket CDN URL, this is belt-and-suspenders for API access).
  drop policy if exists monument_images_public_read on storage.objects;
  create policy monument_images_public_read on storage.objects
    for select to public using (bucket_id = 'monument-images');

  -- Staff-only writes.
  drop policy if exists monument_images_staff_insert on storage.objects;
  create policy monument_images_staff_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'monument-images' and public.is_staff());

  drop policy if exists monument_images_staff_update on storage.objects;
  create policy monument_images_staff_update on storage.objects
    for update to authenticated
    using (bucket_id = 'monument-images' and public.is_staff())
    with check (bucket_id = 'monument-images' and public.is_staff());

  drop policy if exists monument_images_staff_delete on storage.objects;
  create policy monument_images_staff_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'monument-images' and public.is_staff());
exception when others then
  raise warning 'monument-images storage policies skipped — %', sqlerrm;
end $$;

-- ── monuments write policies (staff-only) ────────────────────────────────────
drop policy if exists monuments_staff_insert on public.monuments;
create policy monuments_staff_insert on public.monuments
  for insert to authenticated with check (public.is_staff());

-- (ensure UPDATE + DELETE exist too — idempotent, from 20260613 / 20260612)
drop policy if exists monuments_staff_update on public.monuments;
create policy monuments_staff_update on public.monuments
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists monuments_staff_delete on public.monuments;
create policy monuments_staff_delete on public.monuments
  for delete to authenticated using (public.is_staff());

-- =============================================================================
-- VERIFY (run after applying):
--   • As STAFF (authenticated, not a partner):
--       insert into public.monuments (id, lastname, img)
--         values ('cat-test-1', 'Test', 'https://example.com/x.jpg');   -- succeeds
--       delete from public.monuments where id = 'cat-test-1';            -- cleanup
--     Upload a file to the monument-images bucket in Studio — succeeds.
--   • As a PARTNER (portal user): the same insert is denied (RLS), and an upload
--       to monument-images is denied. select public.is_staff();  -- false
-- =============================================================================
