-- YARD COUNT (Paul 2026-08-03): "EVERYONE IN MY SHOP IS STILL WORKING OFF
-- SPREADSHEETS BECAUSE THEY DONT TRUST STONEBOOKS." Physical verification:
-- verified_* = the last time a human stood in front of the stone (stamped
-- from the Stonebooks Field count mode). status gains 'missing' by
-- convention (no CHECK constraint on inventory_stock.status — verified
-- 2026-08-03): counted and NOT found, kept for Reconcile, never deleted.
-- allocated_order_id (existing, always NULL until now) finally gets used —
-- the Reconcile "Yard stock vs orders" section links the free-text
-- assigned_to names (74 rows, all matching open orders by name) to real ids.
alter table inventory_stock add column if not exists verified_at timestamptz;
alter table inventory_stock add column if not exists verified_by text;
