-- =============================================================================
-- 20260629_orders_permit_meta.sql
-- Orders command-center: permit soft-tracking fields.
-- =============================================================================
-- Adds ONE JSONB column to hold the permit soft fields that don't already have a
-- home (the only genuinely-new permit data):
--   permit_meta = { "type": "...", "cemeteryNotes": "...", "internalNotes": "..." }
-- Mirrors the existing orders.payments[] / orders.permit[] JSONB pattern, so new
-- soft fields can be added later with NO further ALTER. Idempotent + safe to re-run.
--
-- NOTE: needed(y/n), status, submitted/approved dates already live on existing
-- columns (permit_required, permit_status, permit_filed_at, permit_approved_at).
-- The permit FEE (paid/amount/check#/date) is an OUTGOING SHOP EXPENSE and is
-- recorded to outgoing_payments — NEVER here, NEVER on payments[], and it never
-- reduces customer balance due.
-- =============================================================================

alter table public.orders
  add column if not exists permit_meta jsonb not null default '{}'::jsonb;

comment on column public.orders.permit_meta is
  'Permit soft fields: { type, cemeteryNotes, internalNotes }. Status/dates live on '
  'permit_status/permit_required/permit_filed_at/permit_approved_at; the permit FEE is '
  'an outgoing expense in outgoing_payments (never payments[], never balance).';
