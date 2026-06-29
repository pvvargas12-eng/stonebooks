-- =============================================================================
-- 20260629_ordering_vendors_and_stone_vendor.sql
-- Stone-supplier list (persists new vendors) + the chosen vendor per order.
-- =============================================================================
-- The Monument card's Stone Status ("Ordered From →") needs a persistent list of
-- STONE SUPPLIERS (Peerless, Pepin, Tecstone, …). This is NOT the `partners` table
-- (that's the B2B vendor PORTAL — engravers/setters with auth mappings); mixing
-- stone suppliers there would pollute the portal. So a small dedicated list:
-- ordering_vendors. New vendors typed in the UI insert here and stick.
--
-- orders.stone_vendor stores the chosen supplier when stone status = ordered. The
-- stone STATUS itself reuses the existing milestone-backed STONE_STATUS (no new
-- status field, no collision with the schedule import / job milestones). Idempotent.
-- =============================================================================

create table if not exists public.ordering_vendors (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Seed the known stone suppliers (idempotent).
insert into public.ordering_vendors (name) values
  ('Peerless'), ('Pepin'), ('Tecstone'), ('Glennrock'), ('Hall Mo.'), ('Riverside'), ('Gran Trade Inc')
on conflict (tenant_id, name) do nothing;

-- Staff-internal posture: RLS on, authenticated full CRUD, no anon access.
alter table public.ordering_vendors enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ordering_vendors' and policyname='ordering_vendors_authenticated_all') then
    create policy ordering_vendors_authenticated_all on public.ordering_vendors
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- The chosen supplier on an order (when stone status = ordered). Free text so a
-- newly-added vendor works immediately.
alter table public.orders add column if not exists stone_vendor text;

comment on column public.orders.stone_vendor is
  'Stone supplier chosen on the Monument card when stone status = ordered. Names come '
  'from ordering_vendors (a persistent list, NOT the partners portal table).';
