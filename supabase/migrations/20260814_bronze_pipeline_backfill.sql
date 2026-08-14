-- =============================================================================
-- BRONZE-WIRE backfill (2026-08-14, Paul-approved data write)
-- =============================================================================
-- Audit that framed it: 46 active bronze jobs, only 11 with a job_component,
-- 0 on the floor, 0 on install_list, 7 with bronze_received done. The other 35
-- were signed before the bronze track existed (20260630_job_components_bronze)
-- and backfillJobComponents was never run.
--
-- 1) Mint the missing bronze component for every active bronze job that has
--    none — phase derived from the job's own milestones (installed done →
--    delivered; bronze_received done → bronze_received; else bronze_on_order).
--    on_floor stays false (the floor is hand-picked, standing doctrine).
-- 2) Active bronze jobs whose bronze has ARRIVED (bronze_received done,
--    installed still open, order alive) join install_list — the same handoff
--    a blasted stone gets. The new auto-join (_queueInstallOnReadyToSet +
--    setOrderStoneStatus bronze branch) covers this going forward; this
--    catches history up.
-- Every write is logged in _bronze_pipeline_backfill_log. Idempotent: the
-- not-exists guard skips jobs that already have a component, and the
-- install_list add is on-conflict-do-nothing.
-- =============================================================================

create table if not exists _bronze_pipeline_backfill_log (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  action text not null,
  job_id uuid,
  detail jsonb
);

-- 1) Components for active bronze jobs that have none
with candidates as (
  select j.id as job_id, j.order_id,
    exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'installed'       and m.status = 'done') as installed_done,
    exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'bronze_received' and m.status = 'done') as received_done
  from jobs j
  where j.job_type = 'bronze' and j.overall_status = 'active'
    and not exists (select 1 from job_components c where c.job_id = j.id)
),
ins as (
  insert into job_components (job_id, order_id, track, component_type, label, color, current_phase, on_floor, sort_order)
  select c.job_id, c.order_id, 'bronze', 'bronze', 'Bronze', o.granite_color,
    case when c.installed_done then 'delivered'
         when c.received_done  then 'bronze_received'
         else 'bronze_on_order' end,
    false, 0
  from candidates c
  left join orders o on o.id = c.order_id
  returning job_id, current_phase
)
insert into _bronze_pipeline_backfill_log (action, job_id, detail)
select 'component_created', job_id, jsonb_build_object('phase', current_phase) from ins;

-- 2) Received-not-installed bronze joins the install list (alive orders only)
with adds as (
  insert into install_list (job_id, added_by)
  select j.id, 'bronze-wire 2026-08-14'
  from jobs j
  join orders o on o.id = j.order_id
  where j.job_type = 'bronze' and j.overall_status = 'active'
    and coalesce(o.archived, false) = false
    and o.status not in ('closed', 'cancelled')
    and exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'bronze_received' and m.status = 'done')
    and exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'installed'       and m.status <> 'done')
  on conflict (job_id) do nothing
  returning job_id
)
insert into _bronze_pipeline_backfill_log (action, job_id)
select 'install_list_added', job_id from adds;
