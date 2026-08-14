-- 20260811_rls_initplan_policies.sql
-- ✅ APPLIED to prod 2026-08-11 (one ALTER per transaction via Management API — a single
-- DO-block transaction deadlocked against live app queries; this file is the idempotent record).
--
-- WHY: every RLS policy wrote bare `is_staff()` / `vp_my_partner_id()` in USING/WITH CHECK.
-- Postgres evaluates a bare function call in a policy qual PER ROW, and is_staff() runs a
-- subquery against partner_users each time. The getJobs query (jobs + milestones + order embed,
-- mounted by Orders/Jobs/Customers tabs) executed is_staff() ~15,000 times per call:
-- 1.8s mean / 7.7s max server-side (pg_stat_statements, week of 2026-08-03).
-- Wrapping the call as a scalar subquery `(SELECT is_staff())` makes the planner hoist it into
-- an InitPlan: evaluated ONCE per query. Identical semantics, identical security.
-- This is Supabase's own documented RLS optimization ("call functions with select").
--
-- Row-dependent functions (vp_owns_request(id) etc.) are deliberately NOT wrapped — they take
-- per-row arguments and cannot be hoisted.
--
-- RULE FOR EVERY FUTURE POLICY: never write a bare zero-arg function in USING/WITH CHECK.
-- Always `(select is_staff())`, `(select auth.uid())`, `(select vp_my_partner_id())`.

do $$
declare r record; q text; c text; stmt text; cnt int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public','storage')
      and (
        (coalesce(qual,'') like '%is_staff()%' and coalesce(qual,'') not like '%SELECT is_staff()%')
        or (coalesce(with_check,'') like '%is_staff()%' and coalesce(with_check,'') not like '%SELECT is_staff()%')
        or (coalesce(qual,'') like '%vp_my_partner_id()%' and coalesce(qual,'') not like '%SELECT vp_my_partner_id()%')
        or (coalesce(with_check,'') like '%vp_my_partner_id()%' and coalesce(with_check,'') not like '%SELECT vp_my_partner_id()%')
      )
  loop
    q := r.qual; c := r.with_check;
    if q is not null then
      q := replace(q, 'is_staff()', '(SELECT is_staff())');
      q := replace(q, 'vp_my_partner_id()', '(SELECT vp_my_partner_id())');
    end if;
    if c is not null then
      c := replace(c, 'is_staff()', '(SELECT is_staff())');
      c := replace(c, 'vp_my_partner_id()', '(SELECT vp_my_partner_id())');
    end if;
    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then stmt := stmt || format(' USING (%s)', q); end if;
    if c is not null then stmt := stmt || format(' WITH CHECK (%s)', c); end if;
    execute stmt;
    cnt := cnt + 1;
  end loop;
  raise notice 'rewrote % policies to InitPlan form', cnt;
end $$;

-- Verify: expect 0 rows
-- select tablename, policyname from pg_policies
-- where schemaname in ('public','storage')
--   and ((coalesce(qual,'') like '%is_staff()%' and coalesce(qual,'') not like '%SELECT is_staff()%')
--     or (coalesce(with_check,'') like '%is_staff()%' and coalesce(with_check,'') not like '%SELECT is_staff()%'));
