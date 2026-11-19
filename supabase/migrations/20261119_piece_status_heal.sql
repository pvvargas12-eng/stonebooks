-- PIECE-STATUS HEAL (2026-11-19). Paul, Samuelson E-26-0851: the Stone / Bronze
-- status read Arrived while the Monument card's Die / Base status still read
-- Ordered, so the line planner called the stone not ready. The code now keeps
-- the two in step; this heals the open orders already out of step.
-- Scope: active jobs with stone_received done, not blasted, whose piece status
-- still says ordered / not_ordered, AND the arrival is the newer fact (a stone
-- ordered date on file, or marked arrived in November 2026). Three older rows
-- with no ordered date (E-26-0741, E-26-0462, E-26-0358) are left for Paul.
-- UNDO: update orders o set die_stone_status = b.die_before, base_stone_status = b.base_before
--       from _piece_status_heal_20261119 b where b.order_id = o.id;
create table if not exists _piece_status_heal_20261119 (
  order_id uuid primary key, order_number text, die_before text, base_before text, healed_at timestamptz default now());
alter table _piece_status_heal_20261119 enable row level security;

with hit as (
  select distinct o.id, o.order_number, o.die_stone_status, o.base_stone_status
  from orders o
  join jobs j on j.order_id = o.id and j.overall_status = 'active'
  join job_milestones m on m.job_id = j.id and m.milestone_key = 'stone_received' and m.status = 'done'
  where (o.die_stone_status in ('ordered', 'not_ordered') or o.base_stone_status in ('ordered', 'not_ordered'))
    and (o.stone_ordered_date is not null or m.status_date >= date '2026-11-01')
    and not exists (select 1 from job_milestones x where x.job_id = j.id and x.milestone_key = 'production_completed' and x.status = 'done')
), saved as (
  insert into _piece_status_heal_20261119 (order_id, order_number, die_before, base_before)
  select id, order_number, die_stone_status, base_stone_status from hit
  on conflict (order_id) do nothing
  returning order_id
)
update orders o set
  die_stone_status = case when o.die_stone_status in ('ordered', 'not_ordered') then 'in_stock' else o.die_stone_status end,
  base_stone_status = case when o.base_stone_status in ('ordered', 'not_ordered') then 'in_stock' else o.base_stone_status end
from saved where saved.order_id = o.id;
