-- =============================================================================
-- 20260707_trade_jobs.sql
-- STONEBOOKS TRADE — slice 4: trade orders become REAL jobs + the live tracker.
--
-- • jobs.vendor_request_id — third job owner (family order / cemetery order /
--   trade order). The old two-way XOR becomes exactly-one-of-three.
-- • trade_tracker(req) — SECURITY DEFINER RPC returning the dealer-facing
--   tracker steps (placed → accepted → layout approved → stone arrived →
--   stencil cut → blasted → ready → picked up). Partners are RLS-locked out
--   of jobs/job_milestones (private-app posture), so this function is their
--   ONLY window into production — it verifies ownership itself and returns
--   only sanitized step data (no milestone internals).
--
-- Applied to prod via the Supabase Management API on 2026-07-07. Idempotent.
-- =============================================================================

alter table jobs add column if not exists vendor_request_id uuid references vendor_requests(id) on delete set null;
create index if not exists jobs_vendor_request_idx on jobs (vendor_request_id);

-- Exactly ONE owner per job (was: order XOR cemetery_order).
alter table jobs drop constraint if exists jobs_order_or_cemetery_order;
alter table jobs drop constraint if exists jobs_owner_xor;
alter table jobs add constraint jobs_owner_xor check (
  (case when order_id is not null then 1 else 0 end
   + case when cemetery_order_id is not null then 1 else 0 end
   + case when vendor_request_id is not null then 1 else 0 end) = 1
);

-- ── The live tracker ─────────────────────────────────────────────────────────
create or replace function public.trade_tracker(req uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r vendor_requests;
  m_cut text; m_prod_start text; m_prod_done text; m_ready text;
begin
  select * into r from vendor_requests where id = req;
  if r.id is null then return '[]'::jsonb; end if;
  -- Partner isolation: staff (vp_my_partner_id() null) see everything; a
  -- partner session only its own company's orders.
  if public.vp_my_partner_id() is not null and r.partner_id is distinct from public.vp_my_partner_id() then
    return '[]'::jsonb;
  end if;

  if r.job_id is not null then
    select
      max(status_date) filter (where milestone_key = 'stencil_cut' and status = 'done'),
      max(status_date) filter (where milestone_key = 'production_started' and status = 'done'),
      max(status_date) filter (where milestone_key = 'production_completed' and status = 'done'),
      max(status_date) filter (where milestone_key in ('ready_to_install', 'installed') and status = 'done')
    into m_cut, m_prod_start, m_prod_done, m_ready
    from job_milestones where job_id = r.job_id;
  end if;

  return jsonb_build_array(
    jsonb_build_object('key', 'placed',   'label', 'Order placed',     'done', true,                                'date', to_char(r.created_at, 'YYYY-MM-DD')),
    jsonb_build_object('key', 'accepted', 'label', 'Accepted',         'done', r.accepted_at is not null,           'date', to_char(r.accepted_at, 'YYYY-MM-DD')),
    jsonb_build_object('key', 'layout',   'label', 'Layout approved',  'done', r.design_phase = 'approved',         'date', to_char(r.design_approved_at, 'YYYY-MM-DD')),
    jsonb_build_object('key', 'stone',    'label', 'Stone arrived',    'done', r.stone_status = 'arrived',          'date', to_char(r.stone_arrived_at, 'YYYY-MM-DD')),
    jsonb_build_object('key', 'cut',      'label', 'Stencil cut',      'done', m_cut is not null,                   'date', m_cut),
    jsonb_build_object('key', 'blast',    'label', 'Blasted',          'done', m_prod_done is not null,             'date', coalesce(m_prod_done, m_prod_start), 'started', m_prod_start is not null),
    jsonb_build_object('key', 'ready',    'label', 'Ready for pickup', 'done', (m_ready is not null) or r.status in ('ready_for_pickup', 'completed'), 'date', m_ready),
    jsonb_build_object('key', 'picked',   'label', 'Picked up',        'done', r.status = 'completed',              'date', null)
  );
end $$;

grant execute on function public.trade_tracker(uuid) to authenticated;
