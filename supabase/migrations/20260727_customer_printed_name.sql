-- 20260727_customer_printed_name.sql — SALES-5
-- The customer TYPES their name when signing on the iPad (Paul: "they need to
-- type in their name and then also autofill the date"). Stored on the order;
-- the contract generator prints it on the Printed Name line and stamps the
-- signed date on the Date line. Idempotent.
alter table public.orders add column if not exists customer_printed_name text;
