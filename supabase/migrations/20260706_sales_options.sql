-- =============================================================================
-- 20260706_sales_options.sql
-- =============================================================================
-- Settings-managed sales options (Directive 2026-07-06, Part 1).
--
-- ONE extensible table holds owner-editable option lists for the sales flow.
-- category='stone_color' ships first; future categories (monument_type, …)
-- drop in without schema changes.
--
-- KEY DESIGN POINTS
--  • `value` for EXISTING colors equals the GRANITE_COLORS code already stored
--    on orders (`orders.granite_color`, e.g. 'medium-barre-grey') so legacy
--    orders, swatch assets, BLING/vase upcharges and design-family matching
--    keep resolving. New colors get new slugs ('light-gray', …).
--  • `premium` is the same numeric the pricing engine multiplies today: a
--    FRACTION of the base-stone price (0.25 = +25%). The Settings UI displays
--    it as a percent. Carrying the current values over means NO order total
--    changes from this migration.
--  • Soft delete only: is_active=false hides an option from NEW orders;
--    existing orders keep rendering + pricing via their saved code and the
--    order-level premium snapshot (Part 1E). NEVER hard-delete rows.
--  • Origin scrub (Part 2): no current color label contains 'Domestic' or
--    'Vermont', so the seed simply includes every existing color. The label
--    for medium-barre-grey is normalized 'Barre Grey' → 'Barre Gray'.
--
-- RLS posture matches the post-lockdown end state (20260610/20260611):
-- staff-only via permissive authenticated + restrictive is_staff(); anon has
-- no policy (default deny).
--
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.sales_options (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  category   text not null,           -- 'stone_color' now; extensible later
  label      text not null,           -- display name, e.g. 'Barre Gray'
  value      text not null,           -- stable slug; equals orders.granite_color code for existing colors
  premium    numeric not null default 0,  -- fraction of base price (0.25 = +25%)
  image_url  text,                    -- optional swatch; null is fine
  sort_order int not null default 0,
  is_active  boolean not null default true,  -- soft delete; NEVER hard-delete
  created_at timestamptz not null default now(),
  unique (tenant_id, category, value)
);

comment on table public.sales_options is
  'Owner-editable sales option lists (Settings → Sales Options). category=stone_color first. value matches orders.granite_color codes for pre-existing colors. premium is a fraction (0.25 = +25%). Soft-delete via is_active only.';

create index if not exists idx_sales_options_lookup
  on public.sales_options (tenant_id, category, is_active, sort_order);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.sales_options enable row level security;

drop policy if exists "sales_options_authenticated_all" on public.sales_options;
create policy "sales_options_authenticated_all"
on public.sales_options
for all
to authenticated
using (true)
with check (true);

-- Partner lockdown parity (20260610): partners are authenticated but not staff.
drop policy if exists "zz_partner_lockdown_sales_options" on public.sales_options;
create policy "zz_partner_lockdown_sales_options"
on public.sales_options
as restrictive
for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Anon lockdown parity (20260611): explicit block, belt-and-suspenders over
-- default deny.
drop policy if exists "zz_anon_lockdown_sales_options" on public.sales_options;
create policy "zz_anon_lockdown_sales_options"
on public.sales_options
as restrictive
for all
to anon
using (false)
with check (false);

-- ── Swatch image bucket (public read — swatches are marketing assets) ───────
insert into storage.buckets (id, name, public)
values ('sales-options', 'sales-options', true)
on conflict (id) do nothing;

drop policy if exists "Authenticated insert sales-options" on storage.objects;
create policy "Authenticated insert sales-options"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-options');

drop policy if exists "Authenticated update sales-options" on storage.objects;
create policy "Authenticated update sales-options"
  on storage.objects for update to authenticated
  using (bucket_id = 'sales-options') with check (bucket_id = 'sales-options');

drop policy if exists "Authenticated delete sales-options" on storage.objects;
create policy "Authenticated delete sales-options"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sales-options');

-- Public read so <img src=public-url> works without a session.
drop policy if exists "Public read sales-options" on storage.objects;
create policy "Public read sales-options"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'sales-options');

-- ── Seed: stone colors ───────────────────────────────────────────────────────
-- Grays first (directive order), then Imperial Pink, then the rest of the
-- existing catalog in its current family order. Premiums carried over verbatim
-- from the hardcoded GRANITE_COLORS list (fractions). New grays + Imperial
-- Pink premium 0 (Paul sets Imperial Pink's premium in Settings).
insert into public.sales_options (tenant_id, category, label, value, premium, image_url, sort_order)
values
  -- New grays (no swatch images yet)
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Light Gray',         'light-gray',         0,    null,                             10),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Medium Gray',        'medium-gray',        0,    null,                             20),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Dark Gray',          'dark-gray',          0,    null,                             30),
  -- Existing grays (Barre spelling normalized Grey → Gray)
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Barre Gray',         'medium-barre-grey',  0,    '/granite/medium-barre-grey.jpg', 40),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Legacy Gray',        'legacy-gray',        0,    '/granite/legacy-gray.jpg',       50),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'St. Cloud Grey',     'st-cloud-grey',      0,    '/granite/st-cloud-grey.jpg',     60),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Cloud Gray',         'cloud-gray',         0,    '/granite/cloud-gray.png',        70),
  -- New pink (premium editable in Settings; seeded 0 per directive)
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Imperial Pink',      'imperial-pink',      0,    null,                             80),
  -- Black family
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Jet Black',          'jet-black',          0.25, '/granite/jet-black.jpg',         90),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'American Black',     'american-black',     0,    '/granite/american-black.jpg',    100),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Flash Impala Black', 'flash-impala-black', 0,    '/granite/flash-impala-black.jpg',110),
  -- Blue
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Bahama Blue',        'bahama-blue',        0.30, '/granite/bahama-blue.jpg',       120),
  -- Pink family
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Mountain Rose',      'mountain-rose',      0.35, '/granite/mountain-rose.jpg',     130),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Colonial Rose',      'colonial-rose',      0,    '/granite/colonial-rose.jpg',     140),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Salisbury Pink',     'salisbury-pink',     0,    '/granite/salisbury-pink.jpg',    150),
  -- Red family
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'India Red',          'india-red',          0.35, '/granite/india-red.jpg',         160),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Missouri Red',       'missouri-red',       0,    '/granite/missouri-red.jpg',      170),
  -- Mahogany family
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Dakota Mahogany',    'dakota-mahogany',    0.35, '/granite/dakota-mahogany.jpg',   180),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Royal Mahogany',     'royal-mahogany',     0.35, '/granite/royal-mahogany.jpg',    190),
  -- Green
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'China Evergreen',    'china-evergreen',    0,    '/granite/china-evergreen.jpg',   200),
  -- Multi / other
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Cat''s Eye Brown',   'cats-eye-brown',     0.35, '/granite/cats-eye.jpg',          210),
  ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', 'stone_color', 'Paradiso',           'paradiso',           0,    '/granite/paradiso.jpg',          220)
on conflict (tenant_id, category, value) do nothing;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- select count(*) from public.sales_options where category='stone_color';  -- expect 22
