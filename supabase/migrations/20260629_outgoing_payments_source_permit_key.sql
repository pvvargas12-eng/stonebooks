-- =============================================================================
-- 20260629_outgoing_payments_source_permit_key.sql
-- Activates the permit-expense dedup seam (money correctness).
-- =============================================================================
-- The permit fee is money the SHOP pays OUT to the township/cemetery. It is
-- recorded to outgoing_payments (payee = cemetery, category = 'Permits',
-- order_id = the order). It must NEVER touch orders.payments[] and must NEVER
-- reduce the customer's balance due.
--
-- This column gives each permit filing a deterministic key so the SAME permit fee
-- can't be recorded twice (e.g. a double-click, or a re-sync). The partial UNIQUE
-- index enforces at most ONE outgoing row per permit-filing key; rows with a NULL
-- key (all NON-permit outgoing payments) are unconstrained. The application's
-- createPermitOutgoingPayment() already writes this key — this migration turns the
-- guarantee on at the DB layer instead of relying on UI state. Idempotent.
-- =============================================================================

alter table public.outgoing_payments
  add column if not exists source_permit_key text;

create unique index if not exists outgoing_payments_source_permit_key_uniq
  on public.outgoing_payments (source_permit_key)
  where source_permit_key is not null;

comment on column public.outgoing_payments.source_permit_key is
  'Deterministic dedup key for a permit filing ({order_id}:{check#} or '
  '{order_id}:{type}|{amount}|{date}). Partial-unique so a permit fee can be '
  'recorded at most once. NULL for all non-permit outgoing payments.';
