-- =============================================================================
-- ROLLBACK for 20260618_signature_requests.sql
-- Drops the signature_requests table + its storage policy. Leaves the bucket in
-- place (delete it manually only if empty). Run in Supabase Studio. Idempotent.
-- =============================================================================

drop policy if exists signature_requests_staff_all on public.signature_requests;
drop table if exists public.signature_requests cascade;

drop policy if exists signatures_staff_all on storage.objects;

-- To also remove the bucket (only if empty):
--   delete from storage.objects where bucket_id = 'signatures';
--   delete from storage.buckets where id = 'signatures';
