-- =============================================================================
-- 20260530_orders_status_milestones.sql
-- ORDERS REDESIGN — 6 new new_stone milestone keys + requires re-sequence +
-- backfill for existing active new_stone jobs.
-- APPLIED MANUALLY in Supabase Studio 2026-05-30 (ran clean — 6 keys backfilled
-- to 230 active new_stone jobs each). Kept here for the record / re-runnability.
--
-- milestone_templates columns: id, tenant_id, job_type, version, template,
--   is_active, notes  (NO updated_at — do not set it on the template UPDATE).
-- contract_total column on orders was added separately before this migration.
-- Only touches the new_stone template; cleaning_repair unchanged.
-- =============================================================================

-- 1) Template surgery: patch requires on existing keys, append the 6 new keys
--    (inheriting team from siblings so we can't violate job_milestones_team_check),
--    then renumber ALL sort_order from a canonical chain order.
DO $$
DECLARE
  tmpl_id uuid;
  ms jsonb;
  team_design text;
  team_stone  text;
  team_fnd    text;
  new_ms jsonb;
BEGIN
  SELECT id, template->'milestones' INTO tmpl_id, ms
  FROM milestone_templates WHERE job_type = 'new_stone' AND is_active = true LIMIT 1;
  IF tmpl_id IS NULL THEN RAISE EXCEPTION 'new_stone template not found'; END IF;

  SELECT m->>'team' INTO team_design FROM jsonb_array_elements(ms) m WHERE m->>'key' = 'proof_sent';
  SELECT m->>'team' INTO team_stone  FROM jsonb_array_elements(ms) m WHERE m->>'key' = 'stone_ordered';
  SELECT m->>'team' INTO team_fnd    FROM jsonb_array_elements(ms) m WHERE m->>'key' = 'foundation_poured';

  SELECT jsonb_agg(
    CASE m->>'key'
      WHEN 'stone_received'       THEN jsonb_set(m, '{requires}', '["stone_needs_pickup"]'::jsonb)
      WHEN 'foundation_scheduled' THEN jsonb_set(m, '{requires}', '["foundation_need_map"]'::jsonb)
      WHEN 'foundation_poured'    THEN jsonb_set(m, '{requires}', '["foundation_dug"]'::jsonb)
      WHEN 'ready_to_install'     THEN jsonb_set(m, '{requires}', '["production_completed","foundation_in"]'::jsonb)
      ELSE m
    END
  ) INTO ms FROM jsonb_array_elements(ms) m;

  ms := ms || jsonb_build_array(
    jsonb_build_object('key','proof_changes_requested','label','Changes requested','group','design','team',COALESCE(team_design,'sales'),'requires',jsonb_build_array('proof_sent'),'cascades_to','[]'::jsonb,'is_decision',false),
    jsonb_build_object('key','stone_in_stock','label','In stock','group','stone','team',COALESCE(team_stone,'production'),'requires',jsonb_build_array('proof_approved'),'cascades_to','[]'::jsonb,'is_decision',false),
    jsonb_build_object('key','stone_needs_pickup','label','Needs pickup','group','stone','team',COALESCE(team_stone,'production'),'requires',jsonb_build_array('stone_ordered'),'cascades_to','[]'::jsonb,'is_decision',false),
    jsonb_build_object('key','foundation_need_map','label','Need map','group','foundation','team',COALESCE(team_fnd,'admin'),'requires',jsonb_build_array('foundation_needed'),'cascades_to','[]'::jsonb,'is_decision',false),
    jsonb_build_object('key','foundation_dug','label','FDN dug','group','foundation','team',COALESCE(team_fnd,'installation'),'requires',jsonb_build_array('foundation_scheduled'),'cascades_to','[]'::jsonb,'is_decision',false),
    jsonb_build_object('key','foundation_in','label','FDN in','group','foundation','team',COALESCE(team_fnd,'installation'),'requires',jsonb_build_array('foundation_poured'),'cascades_to','[]'::jsonb,'is_decision',false)
  );

  SELECT jsonb_agg(jsonb_set(elem, '{sort_order}', to_jsonb(rn - 1)) ORDER BY rn)
  INTO new_ms
  FROM (
    SELECT elem, row_number() OVER (ORDER BY
      CASE elem->>'key'
        WHEN 'contract_signed'         THEN 1
        WHEN 'deposit_received'        THEN 2
        WHEN 'design_needed'           THEN 3
        WHEN 'proof_created'           THEN 4
        WHEN 'proof_sent'              THEN 5
        WHEN 'proof_changes_requested' THEN 6
        WHEN 'proof_approved'          THEN 7
        WHEN 'stone_in_stock'          THEN 8
        WHEN 'stone_ordered'           THEN 9
        WHEN 'stone_needs_pickup'      THEN 10
        WHEN 'stone_received'          THEN 11
        WHEN 'stencil_created'         THEN 12
        WHEN 'stencil_cut'             THEN 13
        WHEN 'production_started'      THEN 14
        WHEN 'production_completed'    THEN 15
        WHEN 'foundation_needed'       THEN 16
        WHEN 'foundation_need_map'     THEN 17
        WHEN 'foundation_scheduled'    THEN 18
        WHEN 'foundation_dug'          THEN 19
        WHEN 'foundation_poured'       THEN 20
        WHEN 'foundation_in'           THEN 21
        WHEN 'ready_to_install'        THEN 22
        WHEN 'installed'               THEN 23
        ELSE 999
      END,
      COALESCE((elem->>'sort_order')::int, 0)
    ) AS rn
    FROM jsonb_array_elements(ms) elem
  ) q;

  UPDATE milestone_templates
  SET template = jsonb_set(template, '{milestones}', new_ms)
  WHERE id = tmpl_id;
END $$;

-- 2) Sync the re-sequenced requires onto EXISTING active new_stone job rows.
UPDATE job_milestones jm SET requires = '["stone_needs_pickup"]'::jsonb, updated_at = now()
FROM jobs j WHERE jm.job_id = j.id AND j.job_type='new_stone' AND j.overall_status NOT IN ('closed','cancelled') AND jm.milestone_key='stone_received';
UPDATE job_milestones jm SET requires = '["foundation_need_map"]'::jsonb, updated_at = now()
FROM jobs j WHERE jm.job_id = j.id AND j.job_type='new_stone' AND j.overall_status NOT IN ('closed','cancelled') AND jm.milestone_key='foundation_scheduled';
UPDATE job_milestones jm SET requires = '["foundation_dug"]'::jsonb, updated_at = now()
FROM jobs j WHERE jm.job_id = j.id AND j.job_type='new_stone' AND j.overall_status NOT IN ('closed','cancelled') AND jm.milestone_key='foundation_poured';
UPDATE job_milestones jm SET requires = '["production_completed","foundation_in"]'::jsonb, updated_at = now()
FROM jobs j WHERE jm.job_id = j.id AND j.job_type='new_stone' AND j.overall_status NOT IN ('closed','cancelled') AND jm.milestone_key='ready_to_install';

-- 3) Backfill the 6 new keys into existing active new_stone jobs (status not_started).
INSERT INTO job_milestones (id, tenant_id, job_id, milestone_key, label, "group", team, requires, cascades_to, is_decision, status, sort_order, updated_at)
SELECT gen_random_uuid(), j.tenant_id, j.id, m->>'key', m->>'label', m->>'group', m->>'team',
       COALESCE(m->'requires','[]'::jsonb), COALESCE(m->'cascades_to','[]'::jsonb),
       COALESCE((m->>'is_decision')::boolean,false), 'not_started', COALESCE((m->>'sort_order')::int,0), now()
FROM jobs j
JOIN milestone_templates t ON t.job_type = j.job_type AND t.is_active = true
CROSS JOIN LATERAL jsonb_array_elements(t.template->'milestones') AS m
WHERE j.job_type = 'new_stone'
  AND j.overall_status NOT IN ('closed','cancelled')
  AND m->>'key' IN ('proof_changes_requested','stone_in_stock','stone_needs_pickup','foundation_need_map','foundation_dug','foundation_in')
  AND NOT EXISTS (SELECT 1 FROM job_milestones jm WHERE jm.job_id = j.id AND jm.milestone_key = m->>'key');
