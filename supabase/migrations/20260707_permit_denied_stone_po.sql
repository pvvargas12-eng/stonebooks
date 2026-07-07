-- =============================================================================
-- 20260707_permit_denied_stone_po.sql
-- Paul's ops asks (2026-07-07):
--   • Permit DENIED state — permit_status gains 'denied' (JS vocabulary; the
--     column has no check constraint) + permit_denied_at stamp.
--   • Stone purchase record — the date the stone was ORDERED (staff-entered,
--     backdatable; also syncs the stone_ordered milestone) + the supplier's
--     purchase acknowledgement (text ref + optional uploaded file URL).
-- Applied to prod via the Supabase Management API. Idempotent.
-- =============================================================================
alter table orders
  add column if not exists permit_denied_at       timestamptz,
  add column if not exists stone_ordered_date     date,
  add column if not exists stone_purchase_ack     text,
  add column if not exists stone_purchase_ack_url text;
