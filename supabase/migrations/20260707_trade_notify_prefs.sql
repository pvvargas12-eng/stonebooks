-- =============================================================================
-- 20260707_trade_notify_prefs.sql
-- STONEBOOKS TRADE — per-company email notification preferences.
-- partners.notification_prefs jsonb: { placed, accepted, rush, layout_ready,
-- photo, ready, invoice } — a key set to false mutes that email; absent = ON.
-- Dealers edit these in their portal Settings, which needs a partner UPDATE
-- policy on their OWN partners row (V1 gave them select-own only).
-- Applied to prod via the Supabase Management API. Idempotent.
-- =============================================================================
alter table partners add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='partners' and policyname='partners_partner_update') then
    create policy partners_partner_update on partners for update to authenticated
      using (id = public.vp_my_partner_id())
      with check (id = public.vp_my_partner_id());
  end if;
end $$;
