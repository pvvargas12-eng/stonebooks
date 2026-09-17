-- =============================================================================
-- 20260917_proof_rehome_backfill.sql — re-home stranded order-scoped layouts
-- =============================================================================
-- Open exposure flagged 2026-08-14 (RECON-TABS): a layout uploaded ORDER-scoped
-- is invisible to every getCurrentProofsByJob consumer (CutListBoard's
-- NO LAYOUT chip, designStateFor) even after a job exists — createJobFromOrder's
-- 5b carryover only fires at job CREATION. This backfill re-homes existing
-- stranded rows onto their order's job (oldest job when several), but ONLY
-- when that job has no proof rows of its own (the same invariant 5b relies on
-- for version numbering / is_current). Audit at run time: 1 stranded row,
-- 1 re-homeable, 0 conflicted. Idempotent.
-- =============================================================================

update public.proof_versions pv
set job_id = t.job_id, order_id = null
from (
  select distinct on (j.order_id) j.order_id, j.id as job_id
  from public.jobs j
  order by j.order_id, j.created_at asc
) t
where pv.order_id = t.order_id
  and pv.job_id is null
  and not exists (select 1 from public.proof_versions x where x.job_id = t.job_id);

-- ── VERIFY ──
-- select count(*) from proof_versions pv join jobs j on j.order_id = pv.order_id where pv.job_id is null;
