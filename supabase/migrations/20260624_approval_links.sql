-- =============================================================================
-- 20260624_approval_links.sql — token-gated PUBLIC approval links.
-- =============================================================================
-- Backs the public /approve/<token> customer-approval surface. Mirrors the
-- signature_requests model exactly: the raw token is NEVER stored — only its
-- SHA-256 hash (token_hash). All public reads/writes go through the approve-*
-- Edge Functions (service role); there is NO anon/public RLS policy, so the anon
-- key can never touch this table or application data directly.
--
-- One active link per proof version (a partial unique index enforces it);
-- generating a new link revokes the prior one, and bumping to a new proof
-- version revokes all links for older versions (both handled in the data layer /
-- create function).
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- =============================================================================

-- is_staff() — same definition used across the app's lockdown (idempotent).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.approval_links (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',  -- Shevchenko tenant
  order_id          uuid not null references public.orders(id) on delete cascade,
  proof_version_id  uuid not null references public.proof_versions(id) on delete cascade,
  token_hash        text not null unique,                 -- SHA-256 hex of the raw token (raw never stored)
  status            text not null default 'pending'
                      check (status in ('pending','viewed','signed','expired','revoked')),
  expires_at        timestamptz not null default (now() + interval '14 days'),
  viewed_at         timestamptz,
  signed_at         timestamptz,
  revoked_at        timestamptz,
  signer_name       text,
  signer_ip         text,
  signer_user_agent text,
  consent_at        timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index if not exists approval_links_order_idx  on public.approval_links (order_id);
create index if not exists approval_links_proof_idx  on public.approval_links (proof_version_id);
create index if not exists approval_links_token_idx  on public.approval_links (token_hash);
-- At most ONE active (pending/viewed) link per proof version.
create unique index if not exists approval_links_one_active_per_proof
  on public.approval_links (proof_version_id)
  where status in ('pending', 'viewed');

alter table public.approval_links enable row level security;

-- Staff-only direct access (status surface in the CRM). The public approve-*
-- Edge Functions use the service role and bypass RLS — there is NO anon policy.
drop policy if exists approval_links_staff_all on public.approval_links;
create policy approval_links_staff_all on public.approval_links
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- VERIFY:
--   select column_name from information_schema.columns where table_name='approval_links';
--   select relrowsecurity from pg_class where relname='approval_links';  -- t
--   select indexname from pg_indexes where tablename='approval_links';   -- incl. one_active_per_proof
-- No proof_versions columns are needed — the signed packet is pinned in the
-- private bucket (orders-attachments-private), and approval state stamps the
-- existing proof_versions fields (approved_at, approved_by_name, signature_url,
-- signature_method).
-- =============================================================================
