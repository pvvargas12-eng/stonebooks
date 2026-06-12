-- =============================================================================
-- 20260625_approval_links_pdf_cols.sql — unsigned-PDF path + signature rect.
-- =============================================================================
-- Phase 4 stores the immutable UNSIGNED approval packet (generated client-side at
-- send time) in the private bucket, and the signature rect (returned by
-- generateApprovalSheetPDF) so approve-submit stamps server-side at the exact
-- coords. Both live on the approval_links row. Staff-only RLS already covers them.
--
-- APPLY MANUALLY in Supabase Studio (before deploying the approve-* functions).
-- Idempotent.
-- =============================================================================

alter table public.approval_links
  add column if not exists unsigned_pdf_path text,
  add column if not exists sig_field_rects   jsonb;

-- VERIFY:
--   select column_name from information_schema.columns
--     where table_name='approval_links'
--       and column_name in ('unsigned_pdf_path','sig_field_rects');  -- 2 rows
