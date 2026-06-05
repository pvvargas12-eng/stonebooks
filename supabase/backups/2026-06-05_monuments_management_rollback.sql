-- =============================================================================
-- ROLLBACK for 20260614_monuments_management.sql
-- Removes the staff INSERT policy and the monument-images storage policies.
-- Leaves the UPDATE (20260613) and DELETE (20260612) policies in place, and
-- leaves the bucket itself (drop it manually only if it holds no photos you want
-- to keep — deleting a bucket with objects requires emptying it first).
-- Run in Supabase Studio. Idempotent.
-- =============================================================================

drop policy if exists monuments_staff_insert on public.monuments;

drop policy if exists monument_images_public_read   on storage.objects;
drop policy if exists monument_images_staff_insert   on storage.objects;
drop policy if exists monument_images_staff_update   on storage.objects;
drop policy if exists monument_images_staff_delete   on storage.objects;

-- To also remove the bucket (only if empty):
--   delete from storage.objects where bucket_id = 'monument-images';
--   delete from storage.buckets where id = 'monument-images';
