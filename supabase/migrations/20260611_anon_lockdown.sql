-- =============================================================================
-- 20260611_anon_lockdown.sql
-- SECURITY PASS 2 — close the anon hole COMPLETELY. The publishable anon key
-- ships in the frontend (treat it as PUBLIC). The whole app is private: after
-- this, the anon key has ZERO access to ANY table — including the monument
-- catalog. Only authenticated staff (and partner-scoped portal users) see data.
--
-- ⚠ ORDER: apply this ONLY after 20260610_partner_lockdown.sql is applied AND
--   verified (staff still have full access). 20260610 enables RLS on the
--   previously-RLS-off business tables; this migration relies on that. Do not
--   stack two unverified RLS changes.
--
-- ANON ALLOWLIST: EMPTY. The catalog is no longer public — anon reads nothing.
--   The app handles this gracefully: an unauthenticated visitor on the CustomerApp
--   route is sent to a staff sign-in (src/App.jsx CatalogLoginGate), not an empty
--   page. Once signed in, staff are `authenticated` and read the catalog + CRM
--   normally.
--
-- MECHANISM (same non-destructive pattern as 20260610):
--   For EVERY public table (incl. monuments), add a RESTRICTIVE policy:
--       as restrictive to anon using (false) with check (false)
--   Restrictive AND-combines, so any permissive anon/public grant AND false =
--   DENIED — regardless of how anon currently gets in (PASS-1 zz_anon_preserve,
--   monuments_public_read `to anon`, a `to public using(true)` policy, etc.). A
--   `to anon` policy NEVER applies to the `authenticated` role, so STAFF and the
--   PARTNER-lockdown (20260610) are completely untouched. We also DROP the PASS-1
--   zz_anon_preserve grants so the end-state is clean/auditable.
--
-- BEHAVIORAL CONSEQUENCE: the public catalog and the public (anon) SalesMode
--   order-creation path are both closed to anon. The STAFF app is unaffected
--   (staff are authenticated); the catalog is now staff-only behind login.
--
-- APPLY MANUALLY in Studio. Idempotent — if you applied an earlier version of
--   this file (with monuments allow-listed), just RE-RUN it: the loop now also
--   denies anon on monuments. ROLLBACK:
--   supabase/backups/2026-06-04_anon_lockdown_rollback.sql
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — RUN THIS FIRST (read-only). Reports which public tables allow anon
-- access TODAY (RLS off, or a permissive anon/public policy). Change nothing yet.
-- ─────────────────────────────────────────────────────────────────────────────
/*
with anon_oid as (select oid from pg_roles where rolname = 'anon')
select c.relname                          as table_name,
       c.relrowsecurity                   as rls_enabled,
       coalesce(string_agg(p.polname, ', ') filter (
         where p.polpermissive
           and (p.polroles && array[0]::oid[]                       -- PUBLIC (oid 0)
             or p.polroles && array(select oid from anon_oid))      -- anon
       ), '—')                            as anon_granting_policies,
       case
         when not c.relrowsecurity then 'ANON HAS ACCESS (RLS off)'
         when bool_or(p.polpermissive and (p.polroles && array[0]::oid[]
              or p.polroles && array(select oid from anon_oid)))
              then 'ANON HAS ACCESS (anon/public policy)'
         else 'anon blocked'
       end                                as anon_status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by anon_status, c.relname;
-- Expect AFTER this migration: EVERY table shows "anon blocked" (catalog included).
*/


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — deny anon on EVERY table (allowlist is empty — the app is private).
-- excluded = vendor/partner tables (already `to authenticated` only → anon has
--   no access anyway) + our bookkeeping table. monuments is NOT excluded — anon
--   is denied on the catalog too.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  t       text;
  rls_on  boolean;
  allow    text[] := array[]::text[];                     -- EMPTY — no public tables
  excluded text[] := array[
    'partners','partner_users',
    'vendor_requests','vendor_items','vendor_batches','vendor_pos','vendor_po_items',
    'vendor_attachments','vendor_events',
    '_vp_rls_lockdown_log'
  ];
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    if t = any(allow) or t = any(excluded) then
      continue;
    end if;

    begin
      select c.relrowsecurity into rls_on
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t;

      -- Remove the PASS-1 anon-preserve grant (clean end-state) and add the
      -- universal anon-deny restrictive (covers to-public/to-anon grants too).
      execute format('drop policy if exists zz_anon_preserve on public.%I', t);
      execute format('drop policy if exists zz_anon_deny on public.%I', t);
      execute format(
        'create policy zz_anon_deny on public.%I as restrictive '
        'to anon using (false) with check (false)', t);

      if coalesce(rls_on, false) then
        raise notice '[anon-lockdown] % : anon DENIED (dropped zz_anon_preserve, added restrictive zz_anon_deny)', t;
      else
        raise warning '[anon-lockdown] % is RLS-OFF — zz_anon_deny is INERT until RLS is on. Apply 20260610 first, then re-run this.', t;
      end if;

    exception when others then
      raise warning '[anon-lockdown] SKIPPED % — %', t, sqlerrm;
    end;
  end loop;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — THREE-ROLE VERIFICATION (run AFTER applying).
--
-- (a) ANON (anon key, no login) — ZERO access to EVERYTHING:
--        select count(*) from monuments;             -- expect: 0 / denied (catalog now private)
--        select count(*) from customers;             -- expect: 0 / denied
--        select count(*) from orders;                -- expect: 0 / denied
--        select count(*) from jobs;                  -- expect: 0 / denied
--        select count(*) from financial_records;     -- expect: 0 / denied
--        insert into customers (id) values (gen_random_uuid()); -- expect: RLS violation
--
-- (b) STAFF (authenticated, not a partner) — full catalog + CRM UNCHANGED:
--        select public.is_staff();                   -- expect: true
--        select count(*) from orders;                -- expect: all rows
--        select count(*) from customers;             -- expect: all rows
--        select count(*) from monuments;             -- expect: all rows (catalog still works)
--
-- (c) PARTNER (authenticated portal user) — scoped to vendor data only:
--        select public.is_staff();                   -- expect: false
--        select count(*) from orders;                -- expect: 0 (still blocked by 20260610)
--        select count(*) from monuments;             -- expect: 0
--        select count(*) from vendor_requests;       -- expect: only THEIR rows
--
-- Report the per-table NOTICEs + (a)/(b)/(c). If anything breaks, roll back with
-- supabase/backups/2026-06-04_anon_lockdown_rollback.sql (restores post-PASS-1 state).
-- ─────────────────────────────────────────────────────────────────────────────
