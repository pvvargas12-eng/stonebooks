-- Scheduler Substrate — Row Level Security Policies
-- =============================================================================
-- The three scheduler tables (work_batches, work_batch_jobs, job_promises)
-- were created without RLS policies in 20260526_scheduler_substrate.sql.
-- With RLS enabled (Supabase's default for new tables) and no policies in
-- place, every authenticated write fails with:
--   "new row violates row-level security policy"
--
-- This migration enables RLS explicitly (idempotent — no-op if already on)
-- and grants the authenticated role full CRUD on each table. Same posture
-- as a staff-internal app: anyone signed in is trusted. No anon access.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent: DROP POLICY IF EXISTS
-- before each CREATE POLICY, so safe to re-run if anything else lands.
-- =============================================================================

-- ── work_batches ──────────────────────────────────────────────────────────

alter table public.work_batches enable row level security;

drop policy if exists "work_batches_authenticated_all" on public.work_batches;

create policy "work_batches_authenticated_all"
on public.work_batches
for all
to authenticated
using (true)
with check (true);

-- ── work_batch_jobs ───────────────────────────────────────────────────────

alter table public.work_batch_jobs enable row level security;

drop policy if exists "work_batch_jobs_authenticated_all" on public.work_batch_jobs;

create policy "work_batch_jobs_authenticated_all"
on public.work_batch_jobs
for all
to authenticated
using (true)
with check (true);

-- ── job_promises ──────────────────────────────────────────────────────────

alter table public.job_promises enable row level security;

drop policy if exists "job_promises_authenticated_all" on public.job_promises;

create policy "job_promises_authenticated_all"
on public.job_promises
for all
to authenticated
using (true)
with check (true);

-- ── Done ──────────────────────────────────────────────────────────────────
-- Verify with:
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where tablename in ('work_batches', 'work_batch_jobs', 'job_promises');
