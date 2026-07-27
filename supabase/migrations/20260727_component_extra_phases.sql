-- 20260727_component_extra_phases.sql — FLOOR-PARALLEL
-- Paul 2026-07-27 (the Boyd case): "boyd is on the line but its not cut...
-- gotta be able to have the order in multiple spots because there are
-- multiple steps that happen together." A piece keeps ONE primary
-- current_phase and may ALSO appear in other columns — parallel work
-- (stone on the line while the stencil is being cut). Idempotent.
alter table public.job_components add column if not exists extra_phases jsonb not null default '[]'::jsonb;
