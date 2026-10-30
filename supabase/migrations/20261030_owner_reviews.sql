-- ── OWNER-REVIEW-1 (2026-10-30): Reports › Monthly review ────────────────────
-- Paul: "where can I see this report and owner analysis? I want this to be a
-- monthly thing where every single report is uploaded and I get an analysis;
-- I want to see growth."
--
-- One row per reviewed period (a month, a quarter, a year): the score out of
-- ten, the headline, the written analysis, a snapshot of the numbers it was
-- scored on, and where the full report lives (a file in the private receipts
-- bucket and/or an outside link). The month-by-month growth table on the page
-- is DERIVED at read time from orders.payments[] (cash in) and acct_expenses
-- (cash out) — nothing here duplicates those truths; this table holds only
-- the judgement written on top of them.

create table if not exists public.owner_reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  kind          text not null default 'month' check (kind in ('month', 'quarter', 'year')),
  period_start  date not null,
  period_end    date not null,
  score         int check (score between 0 and 10),
  headline      text,
  narrative     text,
  metrics       jsonb not null default '{}'::jsonb,   -- snapshot the review was scored on
  report_path   text,                                  -- receipts bucket path (docs/reviews/...)
  report_url    text,                                  -- outside link (artifact, PDF)
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end >= period_start)
);
create unique index if not exists owner_reviews_period_uq on public.owner_reviews (tenant_id, kind, period_start);

alter table public.owner_reviews enable row level security;

do $$
declare t text := 'owner_reviews';
begin
  if not exists (select 1 from pg_policy where polname = t || '_authenticated_all') then
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_authenticated_all', t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select is_staff())) with check ((select is_staff()))', 'zz_partner_lockdown_' || t, t);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_' || t) then
    execute format('create policy %I on public.%I as restrictive for all to anon using (false) with check (false)', 'zz_anon_lockdown_' || t, t);
  end if;
end $$;
