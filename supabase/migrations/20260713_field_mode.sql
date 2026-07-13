-- =============================================================================
-- 20260713_field_mode.sql — Field Mode substrate
-- =============================================================================
-- 1. orders.field_location — the exact-spot marker captured graveside
--    (rubbings, inscription locations): { lat, lng, accuracy, note, photoUrl,
--    markedAt, markedBy }. JSONB, no backfill needed.
-- 2. inventory_items + inventory_events — Field Mode inventory tab.
--    inventory_events is an append-only ledger (receive / adjust / consume);
--    qty on the item is maintained by the app on each event, and UNDO reverses
--    the event's delta and flags the event undone (audit stays intact).
-- RLS posture matches the rest of the app: staff full CRUD, partners locked
-- out (restrictive is_staff()), anon locked out (restrictive false).
-- Idempotent — safe to re-run.
-- =============================================================================

-- 1 ── orders.field_location
alter table public.orders add column if not exists field_location jsonb;

-- 2 ── inventory
create table if not exists public.inventory_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  name        text not null,
  category    text,
  unit        text not null default 'ea',
  qty         numeric not null default 0,
  min_qty     numeric,
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.inventory_events (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.inventory_items(id) on delete cascade,
  kind        text not null check (kind in ('receive', 'adjust', 'consume')),
  delta       numeric not null,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),
  undone      boolean not null default false,
  undone_at   timestamptz,
  undone_by   text
);

create index if not exists inventory_events_item_idx
  on public.inventory_events (item_id, created_at desc);

-- 3 ── RLS (three-role posture parity)
alter table public.inventory_items  enable row level security;
alter table public.inventory_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'inventory_items_authenticated_all') then
    create policy inventory_items_authenticated_all on public.inventory_items
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'inventory_events_authenticated_all') then
    create policy inventory_events_authenticated_all on public.inventory_events
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_inventory_items') then
    create policy zz_partner_lockdown_inventory_items on public.inventory_items
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_partner_lockdown_inventory_events') then
    create policy zz_partner_lockdown_inventory_events on public.inventory_events
      as restrictive for all to authenticated using (is_staff()) with check (is_staff());
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_inventory_items') then
    create policy zz_anon_lockdown_inventory_items on public.inventory_items
      as restrictive for all to anon using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policy where polname = 'zz_anon_lockdown_inventory_events') then
    create policy zz_anon_lockdown_inventory_events on public.inventory_events
      as restrictive for all to anon using (false) with check (false);
  end if;
end $$;

-- ── VERIFY ──
-- select column_name from information_schema.columns where table_name='orders' and column_name='field_location';
-- select count(*) from inventory_items; select count(*) from inventory_events;
-- select polname from pg_policy where polrelid in ('inventory_items'::regclass,'inventory_events'::regclass);
