-- =============================================================================
-- ROLLBACK for 20260608_gmail_messages.sql — drops the Gmail Path B tables.
-- Run in Supabase Studio. Idempotent. (order_emails / gmail OAuth path untouched.)
-- =============================================================================
drop policy if exists messages_staff_all on public.messages;
drop table if exists public.messages cascade;

drop policy if exists email_sync_state_staff_all on public.email_sync_state;
drop table if exists public.email_sync_state cascade;
