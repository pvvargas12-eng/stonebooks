-- =============================================================================
-- 20260803_website_leads.sql — website form submissions → auto leads (WEB-LEAD-1)
-- =============================================================================
-- Paul 2026-08-03: "when customers fill out a contact us form it goes to our
-- email can that go directly to stonebooks and generate a lead with a task to
-- follow up." The site (Duda via Visual Media) emails every submission to the
-- synced inbox; the client-side sweep recognizes those messages and mints a
-- draft lead + Sales follow-up task. This table is the CLAIM LEDGER: one row
-- per processed message (message_id unique = claim-before-create, so several
-- open desks can never double-create the same lead).
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.website_leads (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null unique references public.messages(id) on delete cascade,
  order_id    uuid,
  customer_id uuid,
  task_id     uuid,
  form_name   text,
  parsed      jsonb,
  status      text not null default 'claimed',   -- claimed | created | skipped_empty | error
  created_at  timestamptz not null default now()
);

alter table public.website_leads enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'website_leads_authenticated_all') then
    create policy website_leads_authenticated_all on public.website_leads
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_website_leads') then
    create policy zz_partner_lockdown_website_leads on public.website_leads
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_website_leads') then
    create policy zz_anon_lockdown_website_leads on public.website_leads
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
