-- =============================================================================
-- 20260630_job_components.sql — per-physical-piece production tracking (PART 2 B1)
-- =============================================================================
-- Each physical piece (a Die, a Base, an Inscription job, a Door) gets its OWN
-- production phase, so a Die can be "Blast" while its Base is "Cut". Three tracks,
-- each with its OWN phase vocabulary (validated per-track below):
--   new_stone:   ready_to_bring_up → brought_to_line → cut → stencil_cut →
--                stencil_stuck → blast → quality_check → ready_to_set
--   inscription: needs_rubbing → stencil_cut → inscription_complete
--   door:        pickup_doors → cut_stencil → stick_stencil → blast →
--                quality_check → drop_off_doors
--
-- A component belongs to an order OR a cemetery_order (door work routes through
-- cemetery_orders with no orders row) — mirrors the jobs.order_id/cemetery_order_id
-- XOR. job_id is nullable until production starts. Phases are the SHOP's own enums
-- and are NEVER milestone keys (shop "cut" ≠ milestone stencil_cut). Idempotent.
-- =============================================================================

create table if not exists public.job_components (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'::uuid,
  order_id          uuid references public.orders(id) on delete cascade,
  cemetery_order_id uuid references public.cemetery_orders(id) on delete cascade,
  job_id            uuid references public.jobs(id) on delete set null,
  track             text not null check (track in ('new_stone', 'inscription', 'door')),
  component_type    text not null check (component_type in ('die', 'base', 'inscription', 'door')),
  label             text,
  size              text,
  color             text,
  current_phase     text not null,
  previous_phase    text,
  blocker           text,
  qc_issue          text,
  notes             text,
  sort_order        integer not null default 0,
  phase_changed_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Belongs to an order OR a cemetery_order (mirrors jobs XOR).
  constraint job_components_parent_chk check (order_id is not null or cemetery_order_id is not null),
  -- current_phase must be valid for THIS component's track (separate enums).
  constraint job_components_phase_chk check (
    (track = 'new_stone'   and current_phase in ('ready_to_bring_up','brought_to_line','cut','stencil_cut','stencil_stuck','blast','quality_check','ready_to_set')) or
    (track = 'inscription' and current_phase in ('needs_rubbing','stencil_cut','inscription_complete')) or
    (track = 'door'        and current_phase in ('pickup_doors','cut_stencil','stick_stencil','blast','quality_check','drop_off_doors'))
  )
);

-- Idempotent re-seed: one component per (parent, component_type, sort_order).
-- Partial indexes because a component has exactly ONE of the two parents.
create unique index if not exists uq_job_components_order
  on public.job_components (order_id, component_type, sort_order) where order_id is not null;
create unique index if not exists uq_job_components_cemorder
  on public.job_components (cemetery_order_id, component_type, sort_order) where cemetery_order_id is not null;
create index if not exists idx_job_components_job   on public.job_components (job_id);
create index if not exists idx_job_components_track on public.job_components (track);
create index if not exists idx_job_components_phase on public.job_components (current_phase);

-- Staff-internal posture: RLS on, staff full CRUD (mirrors inventory_stock).
alter table public.job_components enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_components' and policyname='job_components_staff_all') then
    create policy job_components_staff_all on public.job_components
      as permissive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
end $$;

comment on table public.job_components is
  'Per-physical-piece production tracking (die/base/inscription/door). Three tracks, '
  'each with its OWN phase enum (shop phases, NOT milestone keys). Belongs to an order '
  'OR a cemetery_order. current_phase rolls UP one-way to milestone stone-status (B3).';
