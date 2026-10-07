-- =============================================================================
-- 20261007_floor_cut_retired.sql — the new_stone 'cut' column is retired
-- =============================================================================
-- Paul 2026-10-07: "remove cut from production floor don't need that one."
-- Same treatment as blast/quality_check (20260803): 'cut' stays DB-legal
-- (history), the app never writes it for new_stone again, and the 3 prod
-- pieces parked there move BACK to brought_to_line (both phases roll up to
-- the same Sales status 'needs_stencil_cut' — no false stencil-cut claim).
-- Before-images in _floor_cut_retire_log. Idempotent.
-- =============================================================================

create table if not exists public._floor_cut_retire_log (
  id uuid primary key default gen_random_uuid(),
  component_id uuid,
  before jsonb,
  moved_at timestamptz not null default now()
);

insert into public._floor_cut_retire_log (component_id, before)
select c.id, to_jsonb(c)
from public.job_components c
where c.track = 'new_stone' and c.current_phase = 'cut';

update public.job_components
set previous_phase = current_phase,
    current_phase  = 'brought_to_line',
    phase_changed_at = now(),
    updated_at = now()
where track = 'new_stone' and current_phase = 'cut';

-- Parallel memberships pointing at the dead column are history, not queues.
update public.job_components
set extra_phases = (
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from jsonb_array_elements_text(extra_phases) e
  where e <> 'cut'
), updated_at = now()
where track = 'new_stone' and extra_phases @> '["cut"]'::jsonb;

-- ── VERIFY ──
-- select count(*) from job_components where track='new_stone' and (current_phase='cut' or extra_phases @> '["cut"]'::jsonb);  -- 0
