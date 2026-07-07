-- =============================================================================
-- 20260707_trade_issues.sql
-- STONEBOOKS TRADE — the portal Fix tab (Paul: "issues with Stonebooks Trade
-- they put that in there", like the staff Fix Log — NOT stone repairs).
-- Dealers report portal problems; they land in Paul's Updates feed + badge.
-- RLS: staff full CRUD; partners insert + read their OWN company's issues.
-- Applied to prod via the Supabase Management API. Idempotent.
-- =============================================================================
create table if not exists trade_issues (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partners(id) on delete cascade,
  created_by    text,
  description   text not null,
  page          text,                -- where in the portal it happened (optional)
  status        text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  staff_seen_at timestamptz,         -- null = unseen → counts toward the red badge
  created_at    timestamptz not null default now()
);
create index if not exists trade_issues_partner_idx on trade_issues (partner_id);
create index if not exists trade_issues_unseen_idx on trade_issues (created_at desc) where staff_seen_at is null;

alter table trade_issues enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trade_issues' and policyname='trade_issues_staff_all') then
    create policy trade_issues_staff_all on trade_issues for all to authenticated
      using (public.vp_my_partner_id() is null) with check (public.vp_my_partner_id() is null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trade_issues' and policyname='trade_issues_partner_insert') then
    create policy trade_issues_partner_insert on trade_issues for insert to authenticated
      with check (partner_id = public.vp_my_partner_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='trade_issues' and policyname='trade_issues_partner_select') then
    create policy trade_issues_partner_select on trade_issues for select to authenticated
      using (partner_id = public.vp_my_partner_id());
  end if;
end $$;
