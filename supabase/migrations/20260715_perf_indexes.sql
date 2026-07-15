-- =============================================================================
-- 20260715_perf_indexes.sql — PERF pass, part 3 (additive only)
-- =============================================================================
-- Prod index audit (2026-07-15, pg_indexes) found the orders/jobs tables
-- already carry the hot-path indexes (orders_updated_at_idx, orders_status_idx,
-- orders_tenant_archived_idx, orders_customer_id_idx, orders_cemetery_id_idx,
-- idx_jobs_order_id, idx_jobs_last_update, idx_jobs_tenant_status) — they were
-- created outside the migrations folder. The ONE real gap:
--
-- messages.received_at — getEmailThreadsWorkspace sorts 3000 rows by
-- received_at DESC on every Email tab open; only created_at was indexed.
--
-- Additive DDL only. No row data is read, written, or deleted. Idempotent.
-- =============================================================================

create index if not exists messages_received_idx
  on public.messages (received_at desc nulls last);

-- ── VERIFY ──
-- select indexname from pg_indexes where tablename = 'messages';
