-- URGENT — Adds the signature / contract-conversion columns the app has been
-- writing since Sprint 3b but which were never created in the orders table.
-- Currently blocks saving any signed contract:
--   "Could not find the 'customer_signature_path' column of 'orders' in the schema cache."
--
-- Columns added:
--   customer_signature_url   text         — public URL of customer signature image
--   customer_signature_path  text         — Supabase Storage path for the image
--   rep_signature_url        text         — public URL of sales-rep signature image
--   rep_signature_path       text         — Supabase Storage path for the image
--   signed_at                timestamptz  — when the contract was signed
--   pricing_locked_at        timestamptz  — when pricing was locked (often == signed_at)
--
-- Note: the ephemeral base64 `customerSignature` field in app state is NOT
-- persisted to the database — signatures are uploaded to Supabase Storage
-- and only the URL + path are stored on the order row.
--
-- Run this migration ONCE against the Shevchenko Supabase project.
-- Idempotent: re-runs are safe (IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_signature_url  text,
  ADD COLUMN IF NOT EXISTS customer_signature_path text,
  ADD COLUMN IF NOT EXISTS rep_signature_url       text,
  ADD COLUMN IF NOT EXISTS rep_signature_path      text,
  ADD COLUMN IF NOT EXISTS signed_at               timestamptz,
  ADD COLUMN IF NOT EXISTS pricing_locked_at       timestamptz;

COMMENT ON COLUMN orders.customer_signature_url  IS 'Public URL of the customer signature image in Supabase Storage.';
COMMENT ON COLUMN orders.customer_signature_path IS 'Supabase Storage path for the customer signature image (for delete/replace).';
COMMENT ON COLUMN orders.rep_signature_url       IS 'Public URL of the sales-rep signature image in Supabase Storage.';
COMMENT ON COLUMN orders.rep_signature_path      IS 'Supabase Storage path for the sales-rep signature image.';
COMMENT ON COLUMN orders.signed_at               IS 'Timestamp when the contract was signed by both parties. NULL = still an estimate.';
COMMENT ON COLUMN orders.pricing_locked_at       IS 'Timestamp when pricing was locked (typically equal to signed_at).';
