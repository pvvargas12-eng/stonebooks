-- Sprint S1 — Mausoleum due date range
-- Adds target_completion_end_date column for the "latest" date in the mausoleum range.
-- For mausoleum orders, target_completion_date holds the EARLIEST date,
-- target_completion_end_date holds the LATEST date.
-- Non-mausoleum orders: target_completion_end_date stays null.
-- Run ONCE in Supabase Studio SQL Editor.
-- Idempotent: re-runs are safe (IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS target_completion_end_date date;

COMMENT ON COLUMN orders.target_completion_end_date IS
  'Latest date in the mausoleum completion range. For mausoleum orders only; null for other service types.';
