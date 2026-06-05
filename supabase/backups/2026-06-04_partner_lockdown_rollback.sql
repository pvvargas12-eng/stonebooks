-- =============================================================================
-- ROLLBACK for 20260610_partner_lockdown.sql
-- Restores every table to its EXACT pre-lockdown state using the original RLS
-- flags recorded in public._vp_rls_lockdown_log:
--   • drops the zz_* policies this migration added, and
--   • re-DISABLES RLS on any table that the migration newly enabled (rls_was_enabled = false),
--     while LEAVING RLS enabled on tables that already had it on.
-- Run in Supabase Studio if staff access breaks. Idempotent.
-- =============================================================================

do $$
declare r record;
begin
  -- If the log is missing (e.g. someone dropped it), fall back to dropping our
  -- named policies from every public base table and leaving RLS as-is.
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = '_vp_rls_lockdown_log') then
    for r in
      select c.relname as table_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    loop
      begin
        execute format('drop policy if exists zz_partner_lockdown on public.%I', r.table_name);
        execute format('drop policy if exists zz_staff_all on public.%I', r.table_name);
        execute format('drop policy if exists zz_anon_preserve on public.%I', r.table_name);
      exception when others then
        raise warning '[rollback] %: %', r.table_name, sqlerrm;
      end;
    end loop;
    raise notice '[rollback] log table absent — dropped zz_* policies; RLS flags left unchanged.';
  else
    for r in select table_name, rls_was_enabled from public._vp_rls_lockdown_log loop
      begin
        execute format('drop policy if exists zz_partner_lockdown on public.%I', r.table_name);
        execute format('drop policy if exists zz_staff_all on public.%I', r.table_name);
        execute format('drop policy if exists zz_anon_preserve on public.%I', r.table_name);
        -- Only disable RLS on tables we newly turned it on for.
        if r.rls_was_enabled = false then
          execute format('alter table public.%I disable row level security', r.table_name);
          raise notice '[rollback] % : dropped zz_* policies + RLS disabled (restored OFF)', r.table_name;
        else
          raise notice '[rollback] % : dropped zz_partner_lockdown (RLS stays ON, as before)', r.table_name;
        end if;
      exception when others then
        raise warning '[rollback] %: %', r.table_name, sqlerrm;
      end;
    end loop;
  end if;
end $$;

-- storage.objects partner restriction
do $$ begin
  drop policy if exists zz_partner_lockdown_storage on storage.objects;
exception when others then
  raise warning '[rollback] storage.objects: %', sqlerrm;
end $$;

-- Remove the bookkeeping + helper (drop policies first so nothing depends on it).
drop table if exists public._vp_rls_lockdown_log;
-- CASCADE in case a per-table drop was skipped above and a zz_* policy still
-- references is_staff() — cascade then removes that leftover policy too.
do $$ begin
  drop function if exists public.is_staff() cascade;
exception when others then
  raise warning '[rollback] is_staff() drop skipped — %', sqlerrm;
end $$;

-- =============================================================================
-- After rollback: staff + partners are back to the PRE-lockdown posture
-- (partners can again read non-vendor tables). Re-apply 20260610 to re-lock.
-- =============================================================================
