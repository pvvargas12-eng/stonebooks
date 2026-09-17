-- =============================================================================
-- 20260917_dig_list_rule_backfill.sql — DIG-LIST RULE: fee or Shevco = on it
-- =============================================================================
-- Paul 2026-09-17: "orders that have a foundation fee or are selected for
-- shevco foundation need to be on the foundations list."
-- Runtime rule = orderNeedsDigList (stonebooksData): foundation_type
-- Our Foundation/Strip, OR a NEW_STONE order with the foundation calc ON
-- (pricing.foundationCalc, default true → the 'foundation' line item bills);
-- Cemetery Foundation always opts out. This backfill puts every existing
-- qualifying job on foundation_list: signed active orders, foundation ladder
-- still open (not IN / not N/A), not installed. Idempotent (job_id unique,
-- ON CONFLICT DO NOTHING). Remove stays Paul's override.
-- =============================================================================

insert into public.foundation_list (job_id, added_by)
select j.id, 'fdn-rule-backfill 2026-09-17'
from public.jobs j
join public.orders o on o.id = j.order_id
where o.archived is not true
  and o.status not in ('draft', 'scoping', 'quoted', 'closed', 'cancelled')
  and o.signed_at is not null
  and (
    o.foundation_type in ('Our Foundation', 'Strip')
    or (
      o.service_types::text like '%NEW_STONE%'
      and coalesce(o.pricing->>'foundationCalc', 'true') <> 'false'
      and (o.foundation_type is null or o.foundation_type <> 'Cemetery Foundation')
    )
  )
  -- Foundation ladder still open: has fdn milestones, none of them says IN,
  -- and they aren't ALL not_needed (the N/A read).
  and exists (
    select 1 from public.job_milestones m
    where m.job_id = j.id
      and m.milestone_key in ('foundation_needed','foundation_need_map','foundation_scheduled','foundation_dug','foundation_poured','foundation_in')
      and m.status not in ('not_needed')
  )
  and not exists (
    select 1 from public.job_milestones m
    where m.job_id = j.id and m.milestone_key = 'foundation_in' and m.status = 'done'
  )
  and not exists (
    select 1 from public.job_milestones m
    where m.job_id = j.id
      and m.milestone_key in ('installed','door_installed','work_completed')
      and m.status = 'done'
  )
on conflict (job_id) do nothing;

-- ── VERIFY ──
-- select count(*) from foundation_list where added_by = 'fdn-rule-backfill 2026-09-17';
