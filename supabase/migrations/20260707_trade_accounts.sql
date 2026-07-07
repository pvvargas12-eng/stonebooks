-- =============================================================================
-- 20260707_trade_accounts.sql
-- STONEBOOKS TRADE (Trade Accounts) — slice 1: data layer + order shape.
--
-- Builds ON the Vendor Portal V1 tables (20260608/09/10/11). V1 verified to
-- have NO live users on 2026-07-07 (1 partner row "Hall Monuments", 0
-- partner_users, 1 test request) — so this pass is additive + widening only;
-- nothing is dropped, the Hall Monuments partner row carries over as the
-- first real trade account.
--
-- Adds:
--   • vendor_requests → the TRADE ORDER: family name, dealer order #,
--     services[] (+custom), rush (dealer-written need-by date + any-staff
--     approval), the Accept checkpoint (+ needs_reaccept for post-accept
--     edits), the whiteboard columns (design phase / stone status), dealer
--     archive, and the production job link (slice 4).
--   • vendor_events → the per-order activity log + the staff updates feed
--     (partner_id + actor_role + staff_seen_at; kind check dropped).
--   • vendor_invoices + vendor_invoice_lines — price, bundle several orders
--     into one invoice, rush-fee auto-line (strikeable), sent/paid lifecycle.
--   • partner_invites — reusable per-company self-signup links.
--
-- Applied to prod via the Supabase Management API on 2026-07-07. Idempotent.
-- =============================================================================

-- ── vendor_requests → the TRADE ORDER (order-grain fields) ───────────────────
alter table vendor_requests
  add column if not exists family_name          text,
  add column if not exists dealer_order_number  text,
  add column if not exists services             text[] not null default '{}',
  add column if not exists service_custom       text,
  -- Rush: the dealer WRITES the date they need it by; any staff approves or
  -- declines. Approved rush = guaranteed date (+ auto rush-fee invoice line).
  add column if not exists rush_need_by         date,
  add column if not exists rush_status          text not null default 'none',
  add column if not exists rush_decided_by      text,
  add column if not exists rush_decided_at      timestamptz,
  -- The Accept checkpoint — staff verify specs (and rush), the job is created,
  -- the guarantee attaches. Dealer edits AFTER accept flip needs_reaccept.
  add column if not exists accepted_at          timestamptz,
  add column if not exists accepted_by          text,
  add column if not exists needs_reaccept       boolean not null default false,
  -- Whiteboard columns (design phase mirrors the shop; stone logistics).
  add column if not exists design_phase         text not null default 'not_created',
  add column if not exists design_approved_at   timestamptz,
  add column if not exists stone_status         text not null default 'not_here',
  add column if not exists stone_arrived_at     timestamptz,
  add column if not exists stone_drop_location  text,
  -- Dealer-side archive (their portal's Archived tab).
  add column if not exists archived_at          timestamptz,
  add column if not exists archived_by          text,
  -- Production link (slice 4): accepted trade orders become real jobs.
  add column if not exists job_id               uuid references jobs(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_requests_services_chk') then
    alter table vendor_requests add constraint vendor_requests_services_chk
      check (services <@ array['design','blast','pickup','install','doors','fix','custom']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendor_requests_rush_status_chk') then
    alter table vendor_requests add constraint vendor_requests_rush_status_chk
      check (rush_status in ('none','pending','approved','declined'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendor_requests_design_phase_chk') then
    alter table vendor_requests add constraint vendor_requests_design_phase_chk
      check (design_phase in ('not_created','in_progress','sent_draft','approved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendor_requests_stone_status_chk') then
    alter table vendor_requests add constraint vendor_requests_stone_status_chk
      check (stone_status in ('not_here','arrived'));
  end if;
end $$;
create index if not exists vendor_requests_job_idx on vendor_requests (job_id);

-- ── vendor_items — widen work_type to the trade service vocabulary ───────────
-- (legacy values stay valid; new orders use the services[] on the request and
-- write matching per-item work types)
alter table vendor_items drop constraint if exists vendor_items_work_type_check;
alter table vendor_items add constraint vendor_items_work_type_check
  check (work_type in ('design','blasting','setting','other',
                       'blast','pickup','install','doors','fix','custom'));

-- ── vendor_events → activity log + updates feed ──────────────────────────────
-- The narrow event_type check is dropped: the trade flow logs many kinds
-- (order_created / order_edited / order_accepted / rush_* / layout_* /
-- changes_requested / stone_* / milestone / ready_for_pickup / picked_up /
-- fix_requested / archived / invoice_* / message / note …). Events are
-- internal — a check here adds friction, not safety.
alter table vendor_events drop constraint if exists vendor_events_event_type_check;
alter table vendor_events
  add column if not exists partner_id    uuid references partners(id) on delete cascade,
  add column if not exists actor_role    text not null default 'staff',
  add column if not exists staff_seen_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_events_actor_role_chk') then
    alter table vendor_events add constraint vendor_events_actor_role_chk
      check (actor_role in ('partner','staff'));
  end if;
end $$;
-- The red Vendors badge = unseen partner-actor events. Partial index keeps the
-- count query instant forever.
create index if not exists vendor_events_unseen_idx
  on vendor_events (created_at desc)
  where actor_role = 'partner' and staff_seen_at is null;
create index if not exists vendor_events_partner_idx on vendor_events (partner_id);
-- Backfill partner_id on any existing events via their request.
update vendor_events e set partner_id = r.partner_id
  from vendor_requests r
  where e.request_id = r.id and e.partner_id is null;

-- ── vendor_invoices + lines — price, bundle, send, mark paid ─────────────────
-- No stored total: the total is always the sum of the lines (honest by
-- construction). Rush fees arrive as is_rush_fee lines staff can strike.
create table if not exists vendor_invoices (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references partners(id) on delete cascade,
  invoice_number text,
  status         text not null default 'draft'
                   check (status in ('draft','sent','paid','void')),
  sent_at        timestamptz,
  paid_at        timestamptz,
  paid_note      text,           -- "check #2211" / "Zelle conf 9981…"
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists vendor_invoices_partner_idx on vendor_invoices (partner_id);

create table if not exists vendor_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references vendor_invoices(id) on delete cascade,
  request_id  uuid references vendor_requests(id) on delete set null,
  description text,
  amount      numeric not null default 0,
  is_rush_fee boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists vendor_invoice_lines_invoice_idx on vendor_invoice_lines (invoice_id);

-- ── partner_invites — reusable per-company self-signup links ─────────────────
-- One code can create MANY logins for the same company; revoke or expire any
-- time. The signup itself runs through a service-role Edge Function (slice 8),
-- so partners never need read access to this table.
create table if not exists partner_invites (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  code       text not null unique
               default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  use_count  integer not null default 0
);
create index if not exists partner_invites_partner_idx on partner_invites (partner_id);

-- ── RLS on the new tables ────────────────────────────────────────────────────
-- RLS on + no anon policy = anon denied by default (matches the 20260611
-- private-app posture). STAFF (vp_my_partner_id() IS NULL) = full CRUD, the
-- same predicate the 20260609 vendor policies use. PARTNERS see their own
-- invoices only once SENT (never drafts); lines follow the parent invoice;
-- invites are staff-only.
alter table vendor_invoices      enable row level security;
alter table vendor_invoice_lines enable row level security;
alter table partner_invites      enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_invoices' and policyname='vendor_invoices_staff_all') then
    create policy vendor_invoices_staff_all on vendor_invoices for all to authenticated
      using (public.vp_my_partner_id() is null) with check (public.vp_my_partner_id() is null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_invoices' and policyname='vendor_invoices_partner_select') then
    create policy vendor_invoices_partner_select on vendor_invoices for select to authenticated
      using (partner_id = public.vp_my_partner_id() and status <> 'draft');
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_invoice_lines' and policyname='vendor_invoice_lines_staff_all') then
    create policy vendor_invoice_lines_staff_all on vendor_invoice_lines for all to authenticated
      using (public.vp_my_partner_id() is null) with check (public.vp_my_partner_id() is null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vendor_invoice_lines' and policyname='vendor_invoice_lines_partner_select') then
    create policy vendor_invoice_lines_partner_select on vendor_invoice_lines for select to authenticated
      using (exists (
        select 1 from vendor_invoices v
        where v.id = invoice_id
          and v.partner_id = public.vp_my_partner_id()
          and v.status <> 'draft'
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='partner_invites' and policyname='partner_invites_staff_all') then
    create policy partner_invites_staff_all on partner_invites for all to authenticated
      using (public.vp_my_partner_id() is null) with check (public.vp_my_partner_id() is null);
  end if;
end $$;

-- ── Verification (run after apply) ───────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_name = 'vendor_requests' and column_name in
--   ('family_name','services','rush_need_by','rush_status','accepted_at',
--    'needs_reaccept','design_phase','stone_status','archived_at','job_id');
-- select count(*) from vendor_invoices; select count(*) from partner_invites;
-- select policyname from pg_policies where tablename in
--   ('vendor_invoices','vendor_invoice_lines','partner_invites');
