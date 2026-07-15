-- =============================================================================
-- 20260715_close_stranded_jobs.sql — closed order ⇒ closed job (backfill)
-- =============================================================================
-- Reconcile's bulk close and the closeout-email auto-close set orders.status
-- terminal but never touched the job — 43 jobs sat 'active' (or waiting/held)
-- on closed/cancelled orders, haunting the Jobs queues. The app now closes
-- jobs alongside orders (closeOrder / bulkCloseOrders); this backfill sweeps
-- the strays. Previous statuses saved to _jobs_close_backfill_backup for
-- reversibility. Idempotent.
-- =============================================================================

create table if not exists public._jobs_close_backfill_backup (
  job_id       uuid,
  prev_status  text,
  order_status text,
  backed_up_at timestamptz default now()
);

insert into public._jobs_close_backfill_backup (job_id, prev_status, order_status)
select j.id, j.overall_status, o.status
from public.jobs j join public.orders o on o.id = j.order_id
where o.status in ('closed', 'cancelled')
  and j.overall_status <> 'closed';

update public.jobs j
set overall_status = 'closed',
    closed_at = coalesce(j.closed_at, now()),
    last_update_at = now()
from public.orders o
where o.id = j.order_id
  and o.status in ('closed', 'cancelled')
  and j.overall_status <> 'closed';

-- ── VERIFY ──
-- select count(*) from jobs j join orders o on o.id = j.order_id
--   where o.status in ('closed','cancelled') and j.overall_status <> 'closed';  -- expect 0
