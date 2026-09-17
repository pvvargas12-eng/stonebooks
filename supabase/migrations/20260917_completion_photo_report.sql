-- =============================================================================
-- 20260917_completion_photo_report.sql — CATALOG-INTAKE: list finished photos
-- =============================================================================
-- Paul 2026-09-17: "we are uploading a lot of finished designs... i want to
-- see all the finished final photos and be able to select each one edit the
-- metadata and then upload it to the catalog."
-- Completed-job photos land in orders-attachments-public under
-- {orderId}/completion/… (field CompleteScreen). The client can't scan
-- storage.objects across every order folder, so this SECURITY DEFINER
-- function (staff-gated) returns them all in one call for the Settings >
-- Catalog intake surface. Read-only. Idempotent.
-- =============================================================================

create or replace function public.list_completion_photos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select is_staff()) then
    raise exception 'staff only';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'path', o.name,
        'created_at', o.created_at,
        'size', (o.metadata->>'size')::bigint
      ) order by o.created_at desc), '[]'::jsonb)
    from storage.objects o
    where o.bucket_id = 'orders-attachments-public'
      and o.name like '%/completion/%'
  );
end $$;

revoke all on function public.list_completion_photos() from public;
revoke all on function public.list_completion_photos() from anon;
grant execute on function public.list_completion_photos() to authenticated;

-- ── VERIFY ──
-- select jsonb_array_length(list_completion_photos());
