-- =============================================================================
-- 20260917_pr_acknowledgement.sql — Sprint PR-ACK: vendor order acknowledgements
-- =============================================================================
-- Paul 2026-09-17: "when we create a PO and email it to the vendor they send
-- us an order acknowledgement i need to be able to upload the order
-- acknowledgement and compare it and confirm they have the right data before
-- its official must do this."
--
-- Columns on bulk_orders (the PR header):
--   ack_file_url / ack_file_name / ack_uploaded_at / ack_uploaded_by —
--     the vendor's acknowledgement document (stored in
--     orders-attachments-public under attachments/pr/{bulkOrderId}/).
--   ack_note — anything the vendor changed / flagged.
--   ack_confirmed_at / ack_confirmed_by — the operator compared every line
--     against the ack and confirmed the vendor has the right data. Confirming
--     a SUBMITTED PR also flips it to Ordered (the "official" state).
-- Idempotent.
-- =============================================================================

alter table public.bulk_orders add column if not exists ack_file_url    text;
alter table public.bulk_orders add column if not exists ack_file_name   text;
alter table public.bulk_orders add column if not exists ack_uploaded_at timestamptz;
alter table public.bulk_orders add column if not exists ack_uploaded_by text;
alter table public.bulk_orders add column if not exists ack_note        text;
alter table public.bulk_orders add column if not exists ack_confirmed_at timestamptz;
alter table public.bulk_orders add column if not exists ack_confirmed_by text;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='bulk_orders' and column_name like 'ack_%';
