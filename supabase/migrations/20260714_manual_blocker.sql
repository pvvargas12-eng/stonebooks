-- =============================================================================
-- 20260714_manual_blocker.sql — staff-set order blocker
-- =============================================================================
-- orders.manual_blocker jsonb: { kind: 'needs_call' | 'needs_email',
--   note, setAt, setBy } — or NULL when clear. A MANUAL flag set from the
-- order (distinct from computeOrderPressure's derived blockers); renders as
-- red NEEDS CALL / NEEDS EMAIL chips + the note on Orders rows, board cards,
-- and the order detail. Inherits orders RLS (no policy change needed).
-- Idempotent — safe to re-run.
-- =============================================================================

alter table public.orders add column if not exists manual_blocker jsonb;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='orders' and column_name='manual_blocker';
