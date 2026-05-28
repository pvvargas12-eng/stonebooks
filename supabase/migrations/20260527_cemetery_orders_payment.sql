-- Cemetery Orders — payment capture (Migration I)
-- =============================================================================
-- Four additive columns on cemetery_orders so an operator can record a payment
-- against a submitted order and move it to 'paid':
--   • paid_at         — when payment was recorded (timestamptz, NULL until paid).
--   • paid_amount     — amount received (numeric(10,2)). Defaults in the UI to
--                       total_amount but the operator can edit (partial / over).
--   • payment_method  — free text constrained in the UI to a dropdown:
--                       Check / Credit Card / Cash / Bank transfer / Other.
--   • payment_notes   — optional operator note (check #, confirmation, etc.).
--
-- Status itself stays in the existing `status` column (set to 'paid' on submit
-- of the Mark-as-paid modal). No new status enum/constraint needed.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: ADD COLUMN IF NOT EXISTS.
-- Safe to re-run.
-- =============================================================================

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS paid_amount numeric(10,2);

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS payment_notes text;

COMMENT ON COLUMN cemetery_orders.paid_at IS
  'Timestamp the payment was recorded. NULL until the order is marked paid.';
COMMENT ON COLUMN cemetery_orders.paid_amount IS
  'Amount received. Defaults in the UI to total_amount; editable for partial/overpayment.';
COMMENT ON COLUMN cemetery_orders.payment_method IS
  'Payment method (UI dropdown): Check / Credit Card / Cash / Bank transfer / Other.';
COMMENT ON COLUMN cemetery_orders.payment_notes IS
  'Optional operator note for the payment (check #, confirmation code, etc.).';

-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify with (expect 4 rows):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'cemetery_orders'
--      and column_name in ('paid_at','paid_amount','payment_method','payment_notes')
--    order by column_name;
--   -- expect:
--   --   paid_amount    | numeric                     | YES
--   --   paid_at        | timestamp with time zone    | YES
--   --   payment_method | text                        | YES
--   --   payment_notes  | text                        | YES
