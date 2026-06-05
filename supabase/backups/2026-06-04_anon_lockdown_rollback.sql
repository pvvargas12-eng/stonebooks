-- =============================================================================
-- ROLLBACK for 20260611_anon_lockdown.sql
-- Restores the EXACT post-PASS-1 (20260610) state — i.e. anon access is returned
-- to whatever it was right after the partner-lockdown:
--   • drops the zz_anon_deny restrictive policies this pass added, and
--   • re-creates zz_anon_preserve (anon full access) on the tables that PASS 1
--     had newly enabled RLS on (rls_was_enabled = false in _vp_rls_lockdown_log).
--     Tables that were RLS-on originally keep whatever anon grant they always had
--     (this pass never touched those permissive policies), so dropping
--     zz_anon_deny is enough for them.
-- Does NOT undo 20260610 (run that pass's own rollback for the partner lockdown).
-- Run in Supabase Studio. Idempotent.
-- =============================================================================

do $$
declare
  t        text;
  allow    text[] := array['monuments'];
  excluded text[] := array[
    'partners','partner_users',
    'vendor_requests','vendor_items','vendor_batches','vendor_pos','vendor_po_items',
    'vendor_attachments','vendor_events',
    '_vp_rls_lockdown_log'
  ];
  was_off  boolean;
  have_log boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = '_vp_rls_lockdown_log'
  ) into have_log;

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
      execute format('drop policy if exists zz_anon_deny on public.%I', t);

      -- If PASS 1 newly enabled RLS on this table, it had a zz_anon_preserve
      -- (anon full access) that PASS 2 dropped — restore it.
      was_off := false;
      if have_log then
        select (rls_was_enabled = false) into was_off
        from public._vp_rls_lockdown_log where table_name = t;
      end if;
      if coalesce(was_off, false) then
        execute format('drop policy if exists zz_anon_preserve on public.%I', t);
        execute format(
          'create policy zz_anon_preserve on public.%I as permissive '
          'for all to anon using (true) with check (true)', t);
        raise notice '[anon-rollback] % : dropped zz_anon_deny + restored zz_anon_preserve', t;
      else
        raise notice '[anon-rollback] % : dropped zz_anon_deny (was RLS-on originally — no preserve to restore)', t;
      end if;
    exception when others then
      raise warning '[anon-rollback] %: %', t, sqlerrm;
    end;
  end loop;

  if not have_log then
    raise warning '[anon-rollback] _vp_rls_lockdown_log missing — zz_anon_deny dropped, but could not restore zz_anon_preserve on formerly-RLS-off tables. Anon may stay blocked on those until you re-grant manually.';
  end if;
end $$;

-- =============================================================================
-- After rollback: anon is back to the post-PASS-1 posture (could read the
-- formerly-RLS-off business tables again). Re-apply 20260611 to re-close anon.
-- =============================================================================
