-- =============================================================================
-- 20260608_gmail_messages.sql  (Gmail Integration — Path B, Phase G1)
-- =============================================================================
-- Email store for the single shared shop account (shevcoteam@gmail.com) sent +
-- received over SMTP/IMAP by the Vercel Node email backend (service role). One
-- `messages` row per email (inbound or outbound), deduped by Message-ID, plus a
-- single-row `email_sync_state` for the incremental IMAP poll.
--
-- RLS: STAFF (is_staff()) read/write; the backend uses the service role (bypasses
-- RLS). No anon/public access. Mirrors the lockdown posture.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent.
-- ROLLBACK: supabase/backups/2026-06-08_gmail_messages_rollback.sql
-- =============================================================================

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and not exists (select 1 from partner_users where auth_user_id = auth.uid())
$$;
grant execute on function public.is_staff() to authenticated, anon;

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',  -- Shevchenko tenant
  gmail_message_id text unique,                       -- RFC822 Message-ID — dedupe key
  thread_key       text,                              -- root of References / In-Reply-To
  direction        text not null check (direction in ('inbound','outbound')),
  from_email       text,
  to_emails        text[] not null default '{}',
  subject          text,
  body_text        text,
  body_html        text,
  snippet          text,
  has_attachments  boolean not null default false,
  attachments      jsonb not null default '[]'::jsonb,  -- [{ filename, mime, size, storage_path? }]
  order_id         uuid references public.orders(id)    on delete set null,
  customer_id      uuid references public.customers(id) on delete set null,
  imap_uid         bigint,                            -- IMAP UID (inbound), for incremental sync
  sent_at          timestamptz,
  received_at      timestamptz,
  is_read          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists messages_thread_key_idx  on public.messages (thread_key);
create index if not exists messages_order_idx        on public.messages (order_id);
create index if not exists messages_customer_idx     on public.messages (customer_id);
create index if not exists messages_imap_uid_idx     on public.messages (imap_uid);
create index if not exists messages_created_idx      on public.messages (created_at desc);

alter table public.messages enable row level security;
drop policy if exists messages_staff_all on public.messages;
create policy messages_staff_all on public.messages
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Single shared mailbox → one row keyed by mailbox name. uid_validity guards the
-- IMAP contract: if Gmail resets UIDVALIDITY, the backend must restart from 0.
create table if not exists public.email_sync_state (
  mailbox       text primary key default 'INBOX',
  last_uid      bigint not null default 0,
  uid_validity  bigint,
  last_run_at   timestamptz,
  updated_at    timestamptz not null default now()
);
insert into public.email_sync_state (mailbox) values ('INBOX') on conflict (mailbox) do nothing;

alter table public.email_sync_state enable row level security;
drop policy if exists email_sync_state_staff_all on public.email_sync_state;
create policy email_sync_state_staff_all on public.email_sync_state
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- =============================================================================
-- VERIFY (run after applying):
--   • STAFF (authenticated): insert + select a messages row — succeeds.
--       insert into messages (direction, from_email, subject)
--         values ('outbound', 'shevcoteam@gmail.com', 'verify');
--       select id, direction from messages where subject = 'verify';
--       delete from messages where subject = 'verify';   -- cleanup
--   • ANON (anon key): select * from messages; → 0 rows / denied.
--   • select * from email_sync_state;  → one row, mailbox='INBOX', last_uid=0.
-- =============================================================================
