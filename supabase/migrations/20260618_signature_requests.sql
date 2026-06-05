-- =============================================================================
-- 20260618_signature_requests.sql
-- Remote contract e-signing (link-based). One signature_requests row per signing
-- link + a PRIVATE "signatures" storage bucket for the unsigned/signed PDFs.
--
-- RLS mirrors the lockdown posture used across the app: STAFF (is_staff()) get
-- full access; there is NO public/anon policy. The public signing flow runs
-- ONLY through the service-role Edge Functions (signing-load / signing-submit),
-- which bypass RLS and validate the token on every call.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: supabase/backups/2026-06-05_signature_requests_rollback.sql
-- =============================================================================

-- is_staff() — same definition as the lockdown (idempotent; self-contained).
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.signature_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',  -- Shevchenko tenant
  order_id          uuid not null references public.orders(id) on delete cascade,
  token             text not null unique,
  status            text not null default 'pending'
                      check (status in ('pending','viewed','signed','expired','voided')),
  expires_at        timestamptz not null,
  unsigned_pdf_path text,
  signed_pdf_path   text,
  sig_field_rects   jsonb,                 -- signature/date box coords from the PDF generator
  customer_email    text,
  signer_name       text,
  signer_ip         text,
  signer_user_agent text,
  consent_at        timestamptz,
  viewed_at         timestamptz,
  signed_at         timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid
);
create index if not exists signature_requests_order_idx on public.signature_requests (order_id);
create index if not exists signature_requests_token_idx on public.signature_requests (token);

alter table public.signature_requests enable row level security;

-- Staff-only access (mirrors the orders posture). No public policy — the signing
-- endpoints are service-role and bypass RLS.
drop policy if exists signature_requests_staff_all on public.signature_requests;
create policy signature_requests_staff_all on public.signature_requests
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ── Private bucket for the unsigned/signed PDFs ──────────────────────────────
-- Paths: signatures/<order_id>/<request_id>/unsigned.pdf
--        signatures/<order_id>/<request_id>/signed.pdf
insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'signatures_staff_all'
  ) then
    create policy signatures_staff_all on storage.objects
      for all to authenticated
      using (bucket_id = 'signatures' and public.is_staff())
      with check (bucket_id = 'signatures' and public.is_staff());
  end if;
end $$;

-- =============================================================================
-- VERIFY (run after applying):
--   • As STAFF (authenticated): insert a row + select it back — succeeds.
--       insert into signature_requests (order_id, token, expires_at)
--         values ((select id from orders limit 1), 'verify-token-1', now() + interval '14 days');
--       select id, status from signature_requests where token = 'verify-token-1';
--       delete from signature_requests where token = 'verify-token-1';   -- cleanup
--   • As ANON (anon key, no login): select * from signature_requests; → 0 rows / denied.
--   • Bucket: select id, public from storage.buckets where id = 'signatures'; → public = false.
-- =============================================================================
