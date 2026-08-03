-- =============================================================================
-- 20260803_stone_qc_removed.sql — new_stone loses QC + the Blasted parking column
-- =============================================================================
-- Paul (2026-08-03, from the field): "lets remove QC, when its blasted move it
-- to the ready to install list then add it to installations list." The client
-- ladder is now ...stencil_stuck (Blasting Queue) -> ready_to_set (Ready to
-- Install); 'blast' + 'quality_check' stay DB-LEGAL (history + the door track
-- keeps both) but the app never writes them for new_stone again.
-- This migration moves the stranded pieces forward, per Paul's rule:
--   * every new_stone piece at blast/quality_check -> ready_to_set
--   * their jobs join install_list (blasted = on the installations list)
--   * their stone milestones read blasted (production_completed done)
--   * stale blast/qc extra-phase memberships stripped
-- Before-images in _stone_qc_removal_log. Guarded + idempotent.
-- =============================================================================

create table if not exists _stone_qc_removal_log (
  component_id uuid,
  job_id uuid,
  prev_phase text,
  moved_at timestamptz default now()
);

insert into _stone_qc_removal_log (component_id, job_id, prev_phase)
  select id, job_id, current_phase
  from job_components
  where track = 'new_stone' and current_phase in ('blast', 'quality_check');

update job_components
  set previous_phase = current_phase,
      current_phase = 'ready_to_set',
      phase_changed_at = now(),
      qc_issue = null,
      updated_at = now()
  where track = 'new_stone' and current_phase in ('blast', 'quality_check');

update job_components
  set extra_phases = coalesce(
        (select jsonb_agg(p) from jsonb_array_elements_text(extra_phases) p
          where p not in ('blast', 'quality_check')),
        '[]'::jsonb),
      updated_at = now()
  where track = 'new_stone'
    and (extra_phases ? 'blast' or extra_phases ? 'quality_check');

insert into install_list (job_id, added_by)
  select distinct job_id, 'Blasted — QC removal migration'
  from _stone_qc_removal_log
  where job_id is not null
  on conflict (job_id) do nothing;

update job_milestones
  set status = 'done', status_date = current_date, updated_at = now()
  where job_id in (select distinct job_id from _stone_qc_removal_log where job_id is not null)
    and milestone_key in ('stone_ordered', 'stone_needs_pickup', 'stone_received',
                          'stencil_created', 'stencil_cut', 'production_started', 'production_completed')
    and status <> 'done';
