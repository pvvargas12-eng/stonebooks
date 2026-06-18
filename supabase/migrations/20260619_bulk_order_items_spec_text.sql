-- =============================================================================
-- 20260619_bulk_order_items_spec_text.sql — store the contract-format spec string
-- on each PR line so the print view reads identically to the order's line item.
-- =============================================================================
-- A PR line built from an order's needs carries the EXACT spec string produced by
-- buildDieSpec / buildBaseSpec (the same resolver the contract uses). We persist
-- it here (already prefixed "Die: " / "Base ") so the vendor print sheet renders
-- the line verbatim — no re-resolution, robust to later order edits, and correct
-- even for manually-entered lines (which leave it null and compose from fields).
--
-- Additive + nullable + idempotent. The app degrades gracefully if this hasn't
-- run yet (createStonePR strips spec_text on a missing-column error). RLS is
-- inherited from the table (bulk_order_items already has its staff policy).
-- APPLY MANUALLY in Supabase Studio.
-- =============================================================================

alter table public.bulk_order_items add column if not exists spec_text text;

comment on column public.bulk_order_items.spec_text is
  'Contract-format spec string for this line (buildDieSpec/buildBaseSpec output, prefixed Die:/Base ). Null for manual lines → print composes from color/size/top/sides.';
