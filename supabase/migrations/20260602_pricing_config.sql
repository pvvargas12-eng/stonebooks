-- =============================================================================
-- Settings → Pricing — tenant-scoped owner-editable pricing config
-- =============================================================================
-- ONE JSONB row per tenant holds owner pricing overrides. The row is seeded
-- EMPTY ('{}') on purpose: orderRates.js falls back to the JS constant defaults
-- for every field absent from the JSONB, so NOTHING changes until the owner
-- edits a value in Settings → Pricing and saves. The config schema mirrors the
-- editable rates (see orderRates.snapshotPricingConfig for the exact shape):
--   { version, perUnit{customDiePerSqIn, customDieDefaultThickness,
--     polishSidePerFoot{8,10,12}, sawBasePerFoot, basePolishMarginPerFoot},
--     taxes{njTax, ccSurcharge}, fees{customFontAddon},
--     baseHeights{<in>:upcharge}, inscriptionTiers{<code>:price},
--     acidWashByType{<type>:price}, foundationRates{<shape>:rate},
--     colorPremiums{<code>:fraction}, diePrices{<sizeCode>:price},
--     baseSizePrices{<code>:price}, addOnPrices{<code>:price} }
--
-- RLS: authenticated read + write (staff-internal posture, same as the other
-- tables). NOTE: write is currently open to any authenticated user — the
-- Settings UI gates the editor to the owner, but the DB does NOT yet enforce an
-- owner/staff role. Harden with a role check once a role column exists.
--
-- Run ONCE in Supabase Studio SQL Editor. Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.pricing_config (
  tenant_id  uuid primary key default 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.pricing_config is
  'Tenant-scoped owner-editable pricing overrides (Settings → Pricing). One row per tenant; empty config falls back to JS constant defaults in orderRates.js.';

-- Seed the Shevchenko tenant row (empty config → defaults until edited).
insert into public.pricing_config (tenant_id, config)
values ('a1b2c3d4-e5f6-7890-abcd-ef0123456789', '{}'::jsonb)
on conflict (tenant_id) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.pricing_config enable row level security;

-- Read: any authenticated user (the form needs the config to price orders).
drop policy if exists "pricing_config_authenticated_read" on public.pricing_config;
create policy "pricing_config_authenticated_read"
on public.pricing_config
for select
to authenticated
using (true);

-- Write: any authenticated user FOR NOW (UI gates to owner; harden to a role
-- check when a role column lands). Covers insert + update via the upsert path.
drop policy if exists "pricing_config_authenticated_write" on public.pricing_config;
create policy "pricing_config_authenticated_write"
on public.pricing_config
for all
to authenticated
using (true)
with check (true);
