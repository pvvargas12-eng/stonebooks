-- DOOR-COMPLETE (2026-11-19). Paul: "when they are completed they get marked
-- complete" -- the door track gains a final step after Drop Off Doors.
-- Only the phase CHECK widens (door_complete on the door track); no row moves.
-- UNDO: move any door at door_complete back to drop_off_doors, then re-create
-- the constraint without 'door_complete'.
alter table job_components drop constraint if exists job_components_phase_chk;
alter table job_components add constraint job_components_phase_chk check (
  (track = 'new_stone' and current_phase = any (array['ready_to_bring_up','brought_to_line','cut','stencil_cut','stencil_stuck','blast','quality_check','ready_to_set']))
  or (track = 'inscription' and current_phase = any (array['needs_rubbing','stencil_cut','inscription_complete']))
  or (track = 'door' and current_phase = any (array['pickup_doors','cut_stencil','stick_stencil','blast','quality_check','drop_off_doors','door_complete']))
  or (track = 'bronze' and current_phase = any (array['bronze_on_order','bronze_received','mounted_on_base','delivered']))
);
