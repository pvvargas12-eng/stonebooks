-- =============================================================================
-- 20260626_ensure_proof_changes_requested.sql
-- Bulletproof upsert for the proof_changes_requested "revision pending" signal.
-- =============================================================================
-- proof_changes_requested was only ever added to the new_stone template
-- (20260530); non-new_stone / pre-20260530 / differently-seeded jobs never got
-- the row, so a blind UPDATE on rejection matched zero rows and silently
-- no-opped. There is NO (job_id, milestone_key) unique constraint to ON CONFLICT
-- against. This SECURITY DEFINER function upserts correctly regardless of a job's
-- origin / age / type:
--   * present -> flip to in_progress
--   * absent  -> insert a design-group row, inheriting tenant/team/group/sort
--     from the proof_sent sibling WHEN PRESENT, else valid fallbacks (team
--     'sales' is in job_milestones_team_check; group 'design'); sort_order is
--     max(sort_order)+1 so it can never collide with an existing row.
-- Called identically by approve-submit (service role) and the in-app staff flow.
-- APPLY MANUALLY in Supabase Studio. Idempotent (CREATE OR REPLACE).
-- =============================================================================

create or replace function public.ensure_proof_changes_requested(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sib    job_milestones;
  v_tenant uuid;
  v_next   int;
begin
  if p_job_id is null then return; end if;

  -- Already present → just (re)flip to in_progress.
  if exists (select 1 from job_milestones
             where job_id = p_job_id and milestone_key = 'proof_changes_requested') then
    update job_milestones
       set status = 'in_progress', status_date = current_date, updated_at = now()
     where job_id = p_job_id and milestone_key = 'proof_changes_requested';
    return;
  end if;

  -- Inherit from the proof_sent sibling when present (design group, valid team).
  select * into v_sib
    from job_milestones
   where job_id = p_job_id and milestone_key = 'proof_sent'
   limit 1;

  select tenant_id into v_tenant from jobs where id = p_job_id;

  select coalesce(max(sort_order), 0) + 1 into v_next
    from job_milestones where job_id = p_job_id;

  insert into job_milestones
    (tenant_id, job_id, milestone_key, label, "group", team,
     requires, cascades_to, is_decision, status, status_date, sort_order, updated_at)
  values (
    coalesce(v_sib.tenant_id, v_tenant, 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'),
    p_job_id, 'proof_changes_requested', 'Changes requested',
    coalesce(v_sib."group", 'design'), coalesce(v_sib.team, 'sales'),
    '["proof_sent"]'::jsonb, '[]'::jsonb, false,
    'in_progress', current_date, v_next, now()
  );
end $$;

grant execute on function public.ensure_proof_changes_requested(uuid) to authenticated, service_role;

-- VERIFY (replace <JOB_ID> with a real rejected job):
--   select public.ensure_proof_changes_requested('<JOB_ID>'::uuid);
--   select milestone_key, status from job_milestones
--     where job_id = '<JOB_ID>'::uuid and milestone_key = 'proof_changes_requested';
--   -- expect exactly: proof_changes_requested | in_progress
