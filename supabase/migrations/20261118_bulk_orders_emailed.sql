-- PR-EMAIL-2 (2026-11-18): remember that a purchase request was emailed to the
-- vendor, to whom, and by whom, so the Procurement row can say so and nobody
-- sends it twice. Additive; nothing reads these columns before this deploy.

ALTER TABLE bulk_orders ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE bulk_orders ADD COLUMN IF NOT EXISTS emailed_to text;
ALTER TABLE bulk_orders ADD COLUMN IF NOT EXISTS emailed_by text;

notify pgrst, 'reload schema';
