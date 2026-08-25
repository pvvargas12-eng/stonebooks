-- 2026-08-25 — BRONZE-WIRE round 2: mint bronze components for re-typed jobs.
--
-- The 2026-08-14 backfill guarded on "no components AT ALL", so the ~10 bronze
-- jobs whose orders were re-typed (kept their old new_stone/inscription
-- pieces) never got a bronze piece — nothing to render in the board's Bronze
-- Received column (the Sarmiento E-26-0186 case). Guard here is track-scoped:
-- active bronze job, order alive, NO bronze-track component.
--
-- Phase from the job's own milestones (installed → delivered; received →
-- bronze_received; else bronze_on_order). Received-not-installed pieces go
-- ON-FLOOR (Paul 2026-08-25: received bronze must show in the column);
-- on-order pieces stay off-floor in the queue, per BRONZE-WIRE convention.
-- Old wrong-track pieces are left alone (all off-floor, invisible).
-- Logged in _bronze_pipeline_backfill_log (action 'component_created_r2').

with candidates as (
  select j.id as job_id, j.order_id,
    exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'installed'       and m.status = 'done') as installed_done,
    exists (select 1 from job_milestones m where m.job_id = j.id and m.milestone_key = 'bronze_received' and m.status = 'done') as received_done
  from jobs j
  join orders o on o.id = j.order_id
  where j.job_type = 'bronze' and j.overall_status = 'active'
    and coalesce(o.archived, false) = false
    and o.status not in ('closed', 'cancelled')
    and not exists (select 1 from job_components c where c.job_id = j.id and c.track = 'bronze')
),
ins as (
  insert into job_components (job_id, order_id, track, component_type, label, color, current_phase, on_floor, sort_order)
  select c.job_id, c.order_id, 'bronze', 'bronze', 'Bronze', o.granite_color,
    case when c.installed_done then 'delivered'
         when c.received_done  then 'bronze_received'
         else 'bronze_on_order' end,
    (c.received_done and not c.installed_done),
    0
  from candidates c
  left join orders o on o.id = c.order_id
  returning job_id, current_phase, on_floor
)
insert into _bronze_pipeline_backfill_log (action, job_id, detail)
select 'component_created_r2', job_id, jsonb_build_object('phase', current_phase, 'on_floor', on_floor) from ins;
