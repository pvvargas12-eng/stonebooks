-- =============================================================================
-- 20260609_vendor_portal_rls.sql
-- VENDOR / PARTNER PORTAL V1 — PHASE 3: partner-scoped RLS (multi-tenant isolation).
--
-- PHASE 1 shipped every vendor table with a broad `*_authenticated_all` policy
-- so the INTERNAL staff tab worked immediately. This migration REPLACES those
-- broad policies on the partner-facing tables with two layers:
--
--   1. STAFF  — any authenticated user that is NOT mapped in partner_users
--               (i.e. vp_my_partner_id() IS NULL) keeps full CRUD on everything.
--   2. PARTNER — an authenticated user mapped to a partner sees / touches ONLY
--               their own partner's rows, and only in the ways the portal allows
--               (submit a request, view, upload files, comment). One partner can
--               NEVER see another partner's data.
--
-- Isolation rule of thumb: every partner-readable table is gated by
-- partner_id = vp_my_partner_id() (directly, or via a request/item/po join).
--
-- APPLY MANUALLY in Supabase Studio AFTER 20260608_vendor_portal.sql.
-- Idempotent — safe to re-run.
--
-- VERIFY isolation after applying (run as a partner session, see the comment
-- block at the bottom of this file).
-- =============================================================================

-- ── Helper functions (SECURITY DEFINER so they bypass RLS on partner_users
--    and avoid recursive policy evaluation) ───────────────────────────────────

-- The caller's partner_id, or NULL if they are staff (not a portal user).
create or replace function public.vp_my_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select partner_id from partner_users where auth_user_id = auth.uid() limit 1
$$;

-- Does the caller's partner own this request?
create or replace function public.vp_owns_request(req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select req is not null and exists (
    select 1 from vendor_requests r
    where r.id = req and r.partner_id = public.vp_my_partner_id()
  )
$$;

-- Does the caller's partner own this item (via its request)?
create or replace function public.vp_owns_item(it uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select it is not null and exists (
    select 1 from vendor_items i
    join vendor_requests r on r.id = i.request_id
    where i.id = it and r.partner_id = public.vp_my_partner_id()
  )
$$;

-- Does the caller's partner own this PO?
create or replace function public.vp_owns_po(po uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select po is not null and exists (
    select 1 from vendor_pos p
    where p.id = po and p.partner_id = public.vp_my_partner_id()
  )
$$;

-- ── Drop the PHASE-1 broad policies on partner-facing tables ─────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'partners','partner_users','vendor_batches','vendor_requests','vendor_items',
    'vendor_pos','vendor_po_items','vendor_attachments','vendor_events'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_authenticated_all', t);
  end loop;
end $$;

-- Tiny helper so the rest of the file is a flat list of create-policy blocks
-- without repeating the "drop if exists" guard for idempotency.
create or replace function public._vp_make_policy(
  p_name text, p_table text, p_cmd text, p_using text, p_check text
) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on %I', p_name, p_table);
  if p_cmd = 'insert' then
    execute format('create policy %I on %I for insert to authenticated with check (%s)',
                   p_name, p_table, p_check);
  elsif p_check is null then
    execute format('create policy %I on %I for %s to authenticated using (%s)',
                   p_name, p_table, p_cmd, p_using);
  else
    execute format('create policy %I on %I for %s to authenticated using (%s) with check (%s)',
                   p_name, p_table, p_cmd, p_using, p_check);
  end if;
end $$;

-- ── STAFF: full CRUD on every table when vp_my_partner_id() IS NULL ──────────
do $$
declare t text;
begin
  foreach t in array array[
    'partners','partner_users','vendor_batches','vendor_requests','vendor_items',
    'vendor_pos','vendor_po_items','vendor_attachments','vendor_events'
  ] loop
    perform public._vp_make_policy(
      t || '_staff_all', t, 'all',
      'public.vp_my_partner_id() is null',
      'public.vp_my_partner_id() is null'
    );
  end loop;
end $$;

-- ── PARTNER: scoped read + the narrow writes the portal allows ───────────────

-- partners — see only your own company row (read-only).
select public._vp_make_policy('partners_partner_select', 'partners', 'select',
  'id = public.vp_my_partner_id()', null);

-- partner_users — see only your own mapping row (read-only; lets the app
-- confirm the portal binding client-side if it wants to).
select public._vp_make_policy('partner_users_partner_select', 'partner_users', 'select',
  'partner_id = public.vp_my_partner_id()', null);

-- vendor_batches — see only batches scoped to your partner (read-only;
-- batches are an internal grouping, partners never create them).
select public._vp_make_policy('vendor_batches_partner_select', 'vendor_batches', 'select',
  'partner_id = public.vp_my_partner_id()', null);

-- vendor_requests — see your own; submit new ones for your own partner.
-- (No partner UPDATE: once submitted, staff own the request lifecycle.)
select public._vp_make_policy('vendor_requests_partner_select', 'vendor_requests', 'select',
  'partner_id = public.vp_my_partner_id()', null);
select public._vp_make_policy('vendor_requests_partner_insert', 'vendor_requests', 'insert',
  null, 'partner_id = public.vp_my_partner_id() and source = ''partner''');

-- vendor_items — see / add items under your own requests.
-- (No partner UPDATE/DELETE: line items are staff-owned after submission.)
select public._vp_make_policy('vendor_items_partner_select', 'vendor_items', 'select',
  'public.vp_owns_request(request_id)', null);
select public._vp_make_policy('vendor_items_partner_insert', 'vendor_items', 'insert',
  null, 'public.vp_owns_request(request_id)');

-- vendor_pos — partners can VIEW their POs (read-only).
select public._vp_make_policy('vendor_pos_partner_select', 'vendor_pos', 'select',
  'partner_id = public.vp_my_partner_id()', null);
select public._vp_make_policy('vendor_po_items_partner_select', 'vendor_po_items', 'select',
  'public.vp_owns_po(po_id)', null);

-- vendor_attachments — view your own; upload additional files to your own
-- request/item (uploader_role must be 'partner').
select public._vp_make_policy('vendor_attachments_partner_select', 'vendor_attachments', 'select',
  'public.vp_owns_request(request_id) or public.vp_owns_item(item_id)', null);
select public._vp_make_policy('vendor_attachments_partner_insert', 'vendor_attachments', 'insert',
  null,
  'uploader_role = ''partner'' and (public.vp_owns_request(request_id) or public.vp_owns_item(item_id))');

-- vendor_events — view your own timeline; add comments to your own request/item.
select public._vp_make_policy('vendor_events_partner_select', 'vendor_events', 'select',
  'public.vp_owns_request(request_id) or public.vp_owns_item(item_id)', null);
select public._vp_make_policy('vendor_events_partner_insert', 'vendor_events', 'insert',
  null,
  'public.vp_owns_request(request_id) or public.vp_owns_item(item_id)');

-- Clean up the builder helper — it has served its purpose.
drop function if exists public._vp_make_policy(text, text, text, text, text);

-- ── vendor_events: allow a 'note' type so partners (and staff) can leave
--    comments on a request/item, not just system-generated events. ────────────
alter table vendor_events drop constraint if exists vendor_events_event_type_check;
alter table vendor_events add constraint vendor_events_event_type_check
  check (event_type in ('submitted','status_changed','file_uploaded',
                        'info_requested','email_sent','completed','note'));

-- ── Storage: replace the broad vendor-files policy with staff-all +
--    partner-path-scoped access. Files live under <partner_id>/... so a
--    partner can only touch objects whose first path segment is their id. ─────
drop policy if exists vendor_files_authenticated_all on storage.objects;

do $$ begin
  -- Staff: full access to the bucket.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='vendor_files_staff_all') then
    create policy vendor_files_staff_all on storage.objects
      for all to authenticated
      using (bucket_id = 'vendor-files' and public.vp_my_partner_id() is null)
      with check (bucket_id = 'vendor-files' and public.vp_my_partner_id() is null);
  end if;
  -- Partner: read files under their own <partner_id>/ prefix.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='vendor_files_partner_select') then
    create policy vendor_files_partner_select on storage.objects
      for select to authenticated
      using (bucket_id = 'vendor-files'
             and (storage.foldername(name))[1] = public.vp_my_partner_id()::text);
  end if;
  -- Partner: upload files under their own <partner_id>/ prefix.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='vendor_files_partner_insert') then
    create policy vendor_files_partner_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'vendor-files'
                  and (storage.foldername(name))[1] = public.vp_my_partner_id()::text);
  end if;
end $$;

-- =============================================================================
-- ISOLATION VERIFICATION (run manually after applying — do NOT skip):
--
--   1. As STAFF (your normal login): every vendor_* table should return all
--      rows exactly as before. vp_my_partner_id() returns NULL.
--
--   2. As PARTNER A (a portal user mapped to partner A):
--        select public.vp_my_partner_id();           -- returns partner A's id
--        select count(*) from vendor_requests;       -- ONLY partner A's requests
--        select count(*) from vendor_items;          -- ONLY partner A's items
--        select * from partners;                     -- ONLY partner A's row
--      Try to read partner B's request id directly — must return 0 rows.
--      Try to insert a vendor_request with partner_id = partner B — must FAIL
--      (row-level security violation). This is the isolation guarantee.
-- =============================================================================
