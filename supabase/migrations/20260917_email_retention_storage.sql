-- =============================================================================
-- 20260917_email_retention_storage.sql — Sprint STORAGE-1: retention + usage
-- =============================================================================
-- Paul 2026-09-17: "in settings I need to add a storage bar and see where the
-- most storage is being used... I want every email after 6 months attachments
-- to not be saved... the email traffic can still save... because they are
-- saved in the gmail."
--
-- Audit facts (2026-09-17): the DB was 7.2 GB and messages.body_html alone was
-- 7.1 GB (52k emails, inline-image HTML). Attachment BYTES were never stored —
-- messages.attachments is metadata only (~4 MB); files live in Gmail and are
-- hydrated to storage on demand. So retention = strip body_html (+ the
-- hydrated attachment cache) after 6 months. The app never renders body_html
-- (thread views read body_text / stripped text), so this is invisible.
--
-- 1) messages.body_pruned_at — the sweep's done-marker (sweep lives in
--    /api/email/sync, ~300 rows per cron run).
-- 2) storage_usage_report() — the Settings > Storage data source. SECURITY
--    DEFINER because storage.objects/pg_* aren't anon-readable; staff-gated
--    inside. Returns db + per-table + per-bucket byte counts.
-- Idempotent.
-- =============================================================================

alter table public.messages add column if not exists body_pruned_at timestamptz;

create index if not exists messages_prune_idx
  on public.messages (sent_at)
  where body_pruned_at is null;

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
      select jsonb_build_object(
        'count', count(*),
        'oldest_sent', min(sent_at),
        'pruned', count(*) filter (where body_pruned_at is not null),
        'prunable', count(*) filter (where body_pruned_at is null and sent_at < now() - interval '6 months')
      ) from public.messages
    )
  ) into result;
  return result;
end $$;

revoke all on function public.storage_usage_report() from public;
revoke all on function public.storage_usage_report() from anon;
grant execute on function public.storage_usage_report() to authenticated;

-- ── VERIFY ──
-- select storage_usage_report();
-- select column_name from information_schema.columns where table_name='messages' and column_name='body_pruned_at';
