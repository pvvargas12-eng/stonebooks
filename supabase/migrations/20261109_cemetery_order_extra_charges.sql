-- CEM-INVOICE (2026-11-09): custom charges on a cemetery order + the invoice stamp.
--
-- Per-DOOR additional charges live inside doors[] as door.extras = [{ label, price }]
-- (jsonb, no column). ORDER-level custom charges ("say what it is") get their own
-- column so they are not mistaken for a door. invoiced_at records the last time the
-- one-page invoice was emailed to the cemetery (the send path stamps it).

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS extra_charges jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS invoiced_at timestamptz;

ALTER TABLE cemetery_orders
  ADD COLUMN IF NOT EXISTS invoiced_to text;

COMMENT ON COLUMN cemetery_orders.extra_charges IS
  'Order-level custom charges: [{ label, price }]. Per-door charges live in doors[].extras with the same shape.';
COMMENT ON COLUMN cemetery_orders.invoiced_at IS
  'Last time the one-page invoice was emailed to the cemetery.';
COMMENT ON COLUMN cemetery_orders.invoiced_to IS
  'Recipient address(es) of the last invoice email.';
