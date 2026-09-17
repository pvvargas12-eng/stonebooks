-- =============================================================================
-- 20260917_email_visibility.sql — STORAGE-1 round 2: the visibility window
-- =============================================================================
-- Paul 2026-09-17 (same day as the retention sweep): "i only want emails
-- linked to an order existing over six months to 2 years. if its not linked
-- directly to an order and its older than 6 months remove it from stonebooks
-- (dont delete it just i dont want to see it)."
--
-- So: hidden_at = soft-hide, NEVER a delete. The sweep (api/email/sync
-- hideOldEmails) stamps it when:
--   • order_id IS NULL  and sent_at older than 6 months   (unlinked mail)
--   • any email older than 2 years                        (even order-linked)
-- Every client reader filters hidden_at IS NULL. Rows stay in the DB (zelle /
-- website-lead FKs intact, un-hide = set hidden_at null); Gmail keeps the
-- original either way. Linked-to-a-CUSTOMER-only does NOT count as linked —
-- Paul said "linked directly to an order".
-- Also: storage_usage_report() gains hidden/hideable counts for the panel.
-- Idempotent.
-- =============================================================================

alter table public.messages add column if not exists hidden_at timestamptz;

-- Sweep scan: visible rows by sent date.
create index if not exists messages_hide_sweep_idx
  on public.messages (sent_at)
  where hidden_at is null;

-- Reader lists: visible rows newest-first.
create index if not exists messages_visible_created_idx
  on public.messages (created_at desc)
  where hidden_at is null;

create or replace function public.storage_usage_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (select is_staff()) then
    raise exception 'staff only';
  end if;
  select jsonb_build_object(
    'generated_at', now(),
    'db_total_bytes', pg_database_size(current_database()),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('name', relname, 'bytes', bytes) order by bytes desc), '[]'::jsonb)
      from (
        select c.relname, pg_total_relation_size(c.oid) as bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by pg_total_relation_size(c.oid) desc
        limit 10
      ) t
    ),
    'buckets', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', b.id, 'files', coalesce(c.cnt, 0), 'bytes', coalesce(c.total, 0)) order by coalesce(c.total, 0) desc), '[]'::jsonb)
      from storage.buckets b
      left join lateral (
        select count(*) as cnt, sum((o.metadata->>'size')::bigint) as total
        from storage.objects o where o.bucket_id = b.id
      ) c on true
    ),
    'email', (
      -- Effective age = coalesce(sent_at, received_at): 76% of rows (backfilled
      -- inbound) have NULL sent_at but a real received_at (audit 2026-09-17,
      -- inbox actually reaches back to 2020-09).
      select jsonb_build_object(
        'count', count(*),
        'oldest_sent', min(coalesce(sent_at, received_at)),
        'pruned', count(*) filter (where body_pruned_at is not null),
        'prunable', count(*) filter (where body_pruned_at is null and coalesce(sent_at, received_at) < now() - interval '6 months'),
        'hidden', count(*) filter (where hidden_at is not null),
        'hideable', count(*) filter (where hidden_at is null and (
          (order_id is null and coalesce(sent_at, received_at) < now() - interval '6 months')
          or coalesce(sent_at, received_at) < now() - interval '2 years'))
      ) from public.messages
    )
  ) into result;
  return result;
end $$;

revoke all on function public.storage_usage_report() from public;
revoke all on function public.storage_usage_report() from anon;
grant execute on function public.storage_usage_report() to authenticated;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='messages' and column_name='hidden_at';
-- select count(*) filter (where hidden_at is not null) from messages;
