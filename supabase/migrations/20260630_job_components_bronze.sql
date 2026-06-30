-- =============================================================================
-- 20260630_job_components_bronze.sql — add the 4th track: bronze (PART 2 B1.5)
-- =============================================================================
-- Bronze markers get their own production track (no QC — bronze design is handled
-- in the Design Hub, production is just mount + deliver):
--   bronze: bronze_on_order → bronze_received → mounted_on_base → delivered
-- Extends the track / component_type / per-track phase CHECKs additively. The drop-
-- if-exists + re-add shape is re-runnable. Existing rows are unaffected.
-- =============================================================================

alter table public.job_components drop constraint if exists job_components_track_check;
alter table public.job_components add  constraint job_components_track_check
  check (track in ('new_stone', 'inscription', 'door', 'bronze'));

alter table public.job_components drop constraint if exists job_components_component_type_check;
alter table public.job_components add  constraint job_components_component_type_check
  check (component_type in ('die', 'base', 'inscription', 'door', 'bronze'));

alter table public.job_components drop constraint if exists job_components_phase_chk;
alter table public.job_components add  constraint job_components_phase_chk check (
  (track = 'new_stone'   and current_phase in ('ready_to_bring_up','brought_to_line','cut','stencil_cut','stencil_stuck','blast','quality_check','ready_to_set')) or
  (track = 'inscription' and current_phase in ('needs_rubbing','stencil_cut','inscription_complete')) or
  (track = 'door'        and current_phase in ('pickup_doors','cut_stencil','stick_stencil','blast','quality_check','drop_off_doors')) or
  (track = 'bronze'      and current_phase in ('bronze_on_order','bronze_received','mounted_on_base','delivered'))
);
