-- =============================================================================
-- 20260610_partner_lockdown.sql
-- SECURITY LOCKDOWN — block PARTNER portal users from every NON-vendor table.
--
-- WHY: partner portal users authenticate as the Postgres `authenticated` role,
-- exactly like staff. The vendor_* tables are already partner-scoped (20260609),
-- but core CRM tables (orders, customers, jobs, …) grant `authenticated` broad
-- access — so a logged-in partner could read them via the client. This migration
-- closes that, WITHOUT changing staff access and WITHOUT touching the public
-- anon catalog.
--
-- MECHANISM: a RESTRICTIVE policy per non-vendor table:
--     as restrictive to authenticated using (is_staff()) with check (is_staff())
--   Restrictive policies AND-combine with existing permissive policies, so:
--     • STAFF  (authenticated, NOT in partner_users): permissive grant AND
--              is_staff()=true  → access UNCHANGED.
--     • PARTNER (authenticated, IN partner_users): any permissive AND
--              is_staff()=false → BLOCKED, no matter what permissive policies exist.
--     • ANON   (public catalog, role=anon): a `to authenticated` policy NEVER
--              applies to anon → catalog UNCHANGED.
--   This is why we ADD a restrictive policy rather than DROP the permissive ones:
--   it genuinely excludes partners (AND-combined) while being non-destructive and
--   instantly reversible.
--
-- RLS-DISABLED tables: a restrictive policy is inert while RLS is off, and core
-- tables (orders/customers/jobs/…) were likely created with RLS off. For those
-- this migration ENABLES RLS and adds a permissive `anon_preserve` (to anon,
-- using true) that EXACTLY replicates the prior wide-open anon behavior (so the
-- customer catalog / sales portal can't break) PLUS a staff permissive PLUS the
-- restrictive. The original RLS state is recorded in _vp_rls_lockdown_log so the
-- rollback restores it precisely.
--
-- "staff" = authenticated user with NO partner_users row. This is exactly how
-- the app tells staff from partners (getMyPartnerContext / Phase-3 routing).
-- There is no separate staff/tenant table. ⇒ NEVER add a staff member's email
-- as a partner (it would flip is_staff() false and lock them out).
--
-- APPLY MANUALLY in Supabase Studio AFTER 20260609_vendor_portal_rls.sql.
-- Idempotent — safe to re-run. ROLLBACK: supabase/backups/2026-06-04_partner_lockdown_rollback.sql
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — RUN THIS FIRST (read-only). Reports current RLS state + policies for
-- every non-vendor table so you can see the ground truth before changing it.
-- (Commented out so the migration body doesn't depend on it. Paste + run alone.)
-- ─────────────────────────────────────────────────────────────────────────────
/*
select c.relname                                   as table_name,
       c.relrowsecurity                            as rls_enabled,
       coalesce(count(p.polname), 0)               as policy_count,
       string_agg(p.polname || ' [' ||
         case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end || ']', ', ')
                                                    as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname not in (
    'partners','partner_users','vendor_requests','vendor_items','vendor_batches',
    'vendor_pos','vendor_po_items','vendor_attachments','vendor_events','_vp_rls_lockdown_log'
  )
group by c.relname, c.relrowsecurity
order by c.relname;
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — is_staff() helper (SECURITY DEFINER so it can read partner_users
-- regardless of the caller's RLS). Returns true for authenticated non-partners.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — record table (so rollback knows each table's ORIGINAL rls state).
-- on conflict do nothing ⇒ re-running the migration never overwrites the
-- first-seen original state.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public._vp_rls_lockdown_log (
  table_name      text primary key,
  rls_was_enabled boolean not null,
  applied_at      timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — apply to every non-vendor base table in public. Each table is wrapped
-- in its own exception handler so one un-alterable table (e.g. a PostGIS system
-- table) can't abort the whole run. Every action is RAISE NOTICE'd — the Studio
-- output IS your per-table enumeration/report.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t          text;
  was_on     boolean;
  excluded   text[] := array[
    -- partners legitimately read these (Phase-3 partner-scoped policies own them):
    'partners','partner_users',
    'vendor_requests','vendor_items','vendor_batches','vendor_pos','vendor_po_items',
    'vendor_attachments','vendor_events',
    -- our own bookkeeping:
    '_vp_rls_lockdown_log'
  ];
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    if t = any(excluded) then
      continue;
    end if;

    begin
      select c.relrowsecurity into was_on
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t;

      -- remember the original state ONCE (idempotent across re-runs)
      insert into public._vp_rls_lockdown_log (table_name, rls_was_enabled)
      values (t, coalesce(was_on, false))
      on conflict (table_name) do nothing;

      if coalesce(was_on, false) then
        -- RLS already on: existing permissive policies already serve staff + anon.
        -- Just AND-gate authenticated to staff. (drop-if-exists ⇒ idempotent)
        execute format('drop policy if exists zz_partner_lockdown on public.%I', t);
        execute format(
          'create policy zz_partner_lockdown on public.%I as restrictive '
          'to authenticated using (public.is_staff()) with check (public.is_staff())', t);
        raise notice '[lockdown] % : RLS already ON → added restrictive partner-lockdown', t;
      else
        -- RLS was OFF (wide open to anon + authenticated via GRANTs). Enabling RLS
        -- would deny everyone, so we add: anon_preserve (replicate prior anon
        -- access EXACTLY) + staff permissive + restrictive. Any DORMANT permissive
        -- policy that activates on enable is still AND-blocked for partners by the
        -- restrictive, and ORs harmlessly for anon/staff.
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists zz_anon_preserve on public.%I', t);
        execute format(
          'create policy zz_anon_preserve on public.%I as permissive '
          'for all to anon using (true) with check (true)', t);
        execute format('drop policy if exists zz_staff_all on public.%I', t);
        execute format(
          'create policy zz_staff_all on public.%I as permissive '
          'for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
        execute format('drop policy if exists zz_partner_lockdown on public.%I', t);
        execute format(
          'create policy zz_partner_lockdown on public.%I as restrictive '
          'to authenticated using (public.is_staff()) with check (public.is_staff())', t);
        raise notice '[lockdown] % : RLS was OFF → ENABLED + anon-preserve + staff + restrictive', t;
      end if;

    exception when others then
      raise warning '[lockdown] SKIPPED % — %', t, sqlerrm;
    end;
  end loop;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — storage.objects: block partners from every bucket EXCEPT vendor-files
-- (which the portal needs). Restrictive, so staff + anon + the catalog buckets
-- are untouched; only authenticated PARTNERS are narrowed to vendor-files.
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  drop policy if exists zz_partner_lockdown_storage on storage.objects;
  create policy zz_partner_lockdown_storage on storage.objects as restrictive
    to authenticated
    using (bucket_id = 'vendor-files' or public.is_staff())
    with check (bucket_id = 'vendor-files' or public.is_staff());
exception when others then
  raise warning '[lockdown] storage.objects restrictive policy skipped — %', sqlerrm;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — VERIFICATION (run AFTER applying — tests BOTH sides).
--
-- (a) AS STAFF (your normal staff login, in Studio's SQL editor which runs as a
--     privileged session — to truly test the authenticated path use the app, or
--     impersonate via the API). Quick logic check:
--         select public.is_staff();                         -- expect: true for staff
--         select count(*) from orders;                      -- expect: all rows (unchanged)
--         select count(*) from customers;                   -- expect: all rows
--         select count(*) from jobs;                        -- expect: all rows
--
-- (b) AS A PARTNER (log into the app as an invited partner, OR run these with a
--     partner JWT). Every non-vendor table must be EMPTY / denied:
--         select public.is_staff();                         -- expect: false
--         select count(*) from orders;                      -- expect: 0
--         select count(*) from customers;                   -- expect: 0
--         select count(*) from jobs;                         -- expect: 0
--         select count(*) from financial_records;            -- expect: 0
--         insert into orders (id) values (gen_random_uuid()); -- expect: RLS violation
--     And vendor access still works:
--         select count(*) from vendor_requests;             -- expect: only THEIR rows
--
-- (c) AS ANON (public catalog — no login):
--         select count(*) from monuments;                   -- expect: all rows (catalog OK)
--
-- Report what the per-table NOTICEs said + the (a)/(b)/(c) results.
-- If anything is wrong for staff, roll back instantly with:
--     supabase/backups/2026-06-04_partner_lockdown_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
