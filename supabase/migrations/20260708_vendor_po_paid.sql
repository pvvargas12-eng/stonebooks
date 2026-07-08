-- ============================================================================
-- Vendor invoices: payment received → paid (Paul, 2026-07-08)
-- • status gains 'paid' (check constraint only allowed draft/sent — the same
--   silent-block class as the trade_portal signature_method bug)
-- • payment jsonb — { amount, method, ref, date, recordedBy, at }
-- ============================================================================

alter table vendor_pos drop constraint if exists vendor_pos_status_check;
alter table vendor_pos add constraint vendor_pos_status_check
  check (status in ('draft', 'sent', 'paid'));

alter table vendor_pos add column if not exists payment jsonb;
