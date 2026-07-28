-- =============================================================================
-- 20260728_email_drafts.sql — save-and-resume email drafts (EMAIL-DRAFTS-1)
-- =============================================================================
-- Paul 2026-07-28: "instead of closing I need for all of these email options
-- an option to leave as draft and then in order email be able to view edit
-- and send drafts... i gotta keep restarting."
-- One row per parked composer. `payload` holds the composer's own state
-- (general: to/subject/body/attach; sales/contract: to/note/items/files) so
-- reopening rebuilds the exact screen. Sending deletes the draft.
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.email_drafts (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete cascade,
  customer_id uuid,
  kind        text not null default 'general',   -- general | sales | contract
  payload     jsonb not null default '{}'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists email_drafts_order_idx on public.email_drafts (order_id);

alter table public.email_drafts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'email_drafts_authenticated_all') then
    create policy email_drafts_authenticated_all on public.email_drafts
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_email_drafts') then
    create policy zz_partner_lockdown_email_drafts on public.email_drafts
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_email_drafts') then
    create policy zz_anon_lockdown_email_drafts on public.email_drafts
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;
