-- =============================================================================
-- 20260608_vendor_portal.sql
-- VENDOR / PARTNER PORTAL V1 — data model.
--
-- PHASE 1: all tables + the vendor-files storage bucket. RLS is enabled on every
-- table with an AUTHENTICATED-only full-CRUD policy so the INTERNAL staff tab
-- works immediately. The partner-SCOPED policies (a portal user sees only their
-- own partner's rows) are added in PHASE 3 (20260609_*) so isolation is a
-- deliberate, verified step — staff ship first.
--
-- APPLY MANUALLY in Supabase Studio. Idempotent — safe to re-run.
-- =============================================================================

-- Helper: enable RLS + a single authenticated-all policy (idempotent).
-- (Written inline per table rather than a function so the migration is flat.)

-- ── partners ─────────────────────────────────────────────────────────────────
create table if not exists partners (
  id             uuid primary key default gen_random_uuid(),
  company_name   text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  notes          text,
  payment_terms  text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── partner_users — maps an auth user to exactly one partner (portal RLS) ─────
create table if not exists partner_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  partner_id   uuid not null references partners(id) on delete cascade,
  role         text not null default 'partner' check (role in ('partner')),
  created_at   timestamptz not null default now(),
  unique (auth_user_id)
);
create index if not exists partner_users_partner_idx on partner_users (partner_id);

-- ── vendor_batches — groups items (created before requests for the FK below) ──
create table if not exists vendor_batches (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) on delete cascade,
  name       text,
  status     text not null default 'open'
               check (status in ('open','in_progress','ready_for_pickup','completed','po_sent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendor_batches_partner_idx on vendor_batches (partner_id);

-- ── vendor_requests — parent request (can act as a batch container) ──────────
create table if not exists vendor_requests (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partners(id) on delete cascade,
  request_name  text,
  needed_by     date,
  rush          boolean not null default false,
  general_notes text,
  status        text not null default 'submitted',
  source        text not null default 'internal' check (source in ('partner','internal')),
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- QUOTE PLACEHOLDERS (data only — no UI this build; future owner-review flow)
  quote_required          boolean not null default false,
  quote_status            text not null default 'none',
  quote_approved_by_owner boolean not null default false,
  quote_id                uuid,
  owner_review_status     text not null default 'pending'
);
create index if not exists vendor_requests_partner_idx on vendor_requests (partner_id);

-- ── vendor_items — the stones/items (editable line items) ────────────────────
create table if not exists vendor_items (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null references vendor_requests(id) on delete cascade,
  work_type            text not null default 'other'
                         check (work_type in ('design','blasting','setting','other')),
  vendor_reference     text,
  stone_size           text,
  base_size            text,
  color                text,
  cemetery             text,
  deceased_family_name text,
  item_notes           text,
  status               text not null default 'submitted'
                         check (status in ('submitted','waiting_on_info','ready_to_work',
                                           'in_progress','design_uploaded','ready_for_pickup',
                                           'completed','cancelled')),
  assigned_to          text,
  internal_notes       text,
  batch_id             uuid references vendor_batches(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists vendor_items_request_idx on vendor_items (request_id);
create index if not exists vendor_items_batch_idx on vendor_items (batch_id);
create index if not exists vendor_items_status_idx on vendor_items (status);

-- ── vendor_pos — simple POs (no pricing logic yet) ───────────────────────────
create table if not exists vendor_pos (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid references partners(id) on delete cascade,
  po_number     text,
  po_date       date default current_date,
  status        text not null default 'draft' check (status in ('draft','sent')),
  notes         text,
  custom_amount numeric,
  batch_id      uuid references vendor_batches(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists vendor_pos_partner_idx on vendor_pos (partner_id);

create table if not exists vendor_po_items (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references vendor_pos(id) on delete cascade,
  item_id     uuid references vendor_items(id) on delete set null,
  description text,
  quantity    integer default 1,
  created_at  timestamptz not null default now()
);
create index if not exists vendor_po_items_po_idx on vendor_po_items (po_id);

-- ── vendor_attachments — files per request OR per item ───────────────────────
create table if not exists vendor_attachments (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid references vendor_requests(id) on delete cascade,
  item_id       uuid references vendor_items(id) on delete cascade,
  uploader_role text check (uploader_role in ('partner','staff')),
  kind          text not null default 'upload' check (kind in ('upload','completion_photo')),
  file_path     text not null,
  file_name     text,
  created_at    timestamptz not null default now()
);
create index if not exists vendor_attachments_request_idx on vendor_attachments (request_id);
create index if not exists vendor_attachments_item_idx on vendor_attachments (item_id);

-- ── vendor_events — timeline ─────────────────────────────────────────────────
create table if not exists vendor_events (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid references vendor_requests(id) on delete cascade,
  item_id    uuid references vendor_items(id) on delete cascade,
  event_type text not null
               check (event_type in ('submitted','status_changed','file_uploaded',
                                     'info_requested','email_sent','completed')),
  actor      text,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists vendor_events_request_idx on vendor_events (request_id);
create index if not exists vendor_events_item_idx on vendor_events (item_id);

-- ── RLS: enable + authenticated-all on every table (PHASE 1) ─────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'partners','partner_users','vendor_batches','vendor_requests','vendor_items',
    'vendor_pos','vendor_po_items','vendor_attachments','vendor_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_authenticated_all'
    ) then
      execute format(
        'create policy %I on %I for all to authenticated using (true) with check (true)',
        t || '_authenticated_all', t
      );
    end if;
  end loop;
end $$;

-- ── Storage: dedicated private bucket for vendor files ───────────────────────
-- Private — in-portal downloads use the authenticated session; emailed links use
-- signed URLs (never make this bucket public). PHASE 1 grants authenticated full
-- access; PHASE 3 path-scopes partner access (files are stored under
-- <partner_id>/...).
insert into storage.buckets (id, name, public)
values ('vendor-files', 'vendor-files', false)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'vendor_files_authenticated_all'
  ) then
    create policy vendor_files_authenticated_all on storage.objects
      for all to authenticated
      using (bucket_id = 'vendor-files')
      with check (bucket_id = 'vendor-files');
  end if;
end $$;
