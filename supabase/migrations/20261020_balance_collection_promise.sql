-- ── COLLECT-2 (2026-10-20): promise-to-pay on the Collect balances row ──────
-- Paul: "add a promise-to-pay date on each Collect balances row that mints a
-- reminder task when the date passes." A promise is one more log row (kind
-- 'promise') carrying the date; the reminder is a shop_tasks row due that day
-- (details.auto = 'promise_to_pay'), re-dated when a newer promise is made.

alter table public.balance_collection_log add column if not exists promised_for date;
alter table public.balance_collection_log add column if not exists task_id uuid;

alter table public.balance_collection_log drop constraint if exists balance_collection_log_kind_check;
alter table public.balance_collection_log
  add constraint balance_collection_log_kind_check
  check (kind in ('call', 'email', 'text', 'note', 'promise'));
