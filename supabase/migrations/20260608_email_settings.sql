-- =============================================================================
-- 20260608_email_settings.sql  (Gmail — shop-wide email signature)
-- =============================================================================
-- One shared signature appended to every outgoing email. Single row per tenant.
-- The app falls back to a built-in default signature until this is applied, so it
-- works before the migration runs (deploy-safe).
--
-- RLS: STAFF (is_staff()) read/write. APPLY MANUALLY in Studio. Idempotent.
-- ROLLBACK: drop table if exists public.email_settings;
-- =============================================================================

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.email_settings (
  tenant_id      uuid primary key default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  signature_html text,
  signature_text text,
  updated_at     timestamptz not null default now()
);

insert into public.email_settings (tenant_id, signature_text, signature_html) values (
  'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  E'Shevchenko Monuments, LLC.\n329 S Florida Grove Rd, Perth Amboy, NJ 08861\n732-442-1286 · shevcoteam@gmail.com',
  '<div style="font-size:13px;line-height:1.5;color:#555;font-family:Arial,sans-serif;"><strong>Shevchenko Monuments, LLC.</strong><br>329 S Florida Grove Rd, Perth Amboy, NJ 08861<br>732-442-1286 &middot; <a href="mailto:shevcoteam@gmail.com">shevcoteam@gmail.com</a></div>'
) on conflict (tenant_id) do nothing;

alter table public.email_settings enable row level security;
drop policy if exists email_settings_staff_all on public.email_settings;
create policy email_settings_staff_all on public.email_settings
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- VERIFY: select signature_text from email_settings;  -> the seeded default.
