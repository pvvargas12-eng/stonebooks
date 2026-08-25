-- 2026-08-25 — Bronze <-> install-list sync backfill (Paul: "bronze received
-- and the install list are the same thing") + the Aber FDN fix.
--
-- 1. Three bronze jobs ON the install list without bronze_received done
--    (King E-26-0501, Vargas E-26-0505, Levine E-26-0265) get their
--    bronze_ordered + bronze_received milestones flipped done — install-list
--    membership implies Received, matching the new app-side sync.
-- 2. Levine's bronze component sits at bronze_received but off-floor — pulled
--    on-floor so it shows in the board's Bronze Received column.
-- 3. Aber E-26-0110 (bronze) has NO foundation_in milestone row (the bronze
--    template ladder ends at foundation_poured), so "FDN In" could never be
--    selected. Row seeded DONE — Paul was actively trying to set it.
-- Before-images in _bronze_install_sync_log. Guarded + idempotent.

create table if not exists _bronze_install_sync_log (
  id bigserial primary key,
  at timestamptz default now(),
  kind text,
  job_id uuid,
  detail jsonb
);

-- (1) milestone flips — before-images first
insert into _bronze_install_sync_log (kind, job_id, detail)
select 'milestone_before', jm.job_id, to_jsonb(jm)
from job_milestones jm
where jm.job_id in ('7d07e7ca-0883-4d91-b747-25fe7e5127b8',  -- King E-26-0501
                    'db26ff8a-9c6e-45b0-b7c8-975ec301e297',  -- Vargas E-26-0505
                    '7f87e58f-041a-47c8-b556-5bb7c08237c7')  -- Levine E-26-0265
  and jm.milestone_key in ('bronze_ordered','bronze_received')
  and jm.status <> 'done';

update job_milestones set status = 'done', status_date = current_date, updated_at = now()
where job_id in ('7d07e7ca-0883-4d91-b747-25fe7e5127b8',
                 'db26ff8a-9c6e-45b0-b7c8-975ec301e297',
                 '7f87e58f-041a-47c8-b556-5bb7c08237c7')
  and milestone_key in ('bronze_ordered','bronze_received')
  and status <> 'done';

-- (2) Levine floor piece
insert into _bronze_install_sync_log (kind, job_id, detail)
select 'component_before', c.job_id, to_jsonb(c)
from job_components c
where c.job_id = '7f87e58f-041a-47c8-b556-5bb7c08237c7'
  and c.track = 'bronze' and c.current_phase = 'bronze_received' and c.on_floor = false;

update job_components set on_floor = true
where job_id = '7f87e58f-041a-47c8-b556-5bb7c08237c7'
  and track = 'bronze' and current_phase = 'bronze_received' and on_floor = false;

-- (3) Aber foundation_in — seed done (row does not exist on the bronze template)
insert into _bronze_install_sync_log (kind, job_id, detail)
select 'fdn_seed', '8302d49b-6be9-45b6-ac31-270f02f85ad4',
       '{"note":"foundation_in seeded done - bronze template had no row (Aber E-26-0110)"}'::jsonb
where not exists (
  select 1 from job_milestones
  where job_id = '8302d49b-6be9-45b6-ac31-270f02f85ad4' and milestone_key = 'foundation_in'
);

insert into job_milestones (job_id, milestone_key, label, "group", team, status, status_date, sort_order)
select '8302d49b-6be9-45b6-ac31-270f02f85ad4', 'foundation_in', 'FDN in', 'foundation', 'installation', 'done', current_date, 12
where not exists (
  select 1 from job_milestones
  where job_id = '8302d49b-6be9-45b6-ac31-270f02f85ad4' and milestone_key = 'foundation_in'
);
