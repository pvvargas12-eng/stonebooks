-- =============================================================================
-- RESET-TAG-1 (2026-10-19) — the yard reset + numbered stones
-- =============================================================================
-- Paul is re-founding his stone inventory from scratch: he walks the yard zone
-- by zone, paints a permanent running number on a sawn face of every stone
-- (001, 002, ...), tapes its status (blue = free / green = sold, family name +
-- order number / red = problem) and records each stone on his phone.
--
--   yard_tag        the painted running number. Plain integer, no meaning
--                   encoded, UNIQUE per tenant among the rows that carry one.
--                   NEVER REUSED: getNextYardTag() = max(yard_tag) + 1 over
--                   live AND archived rows, so a number painted on a stone
--                   stays that stone's number even after the row is retired.
--   zone / crate    where the stone sits (zone chips on the phone, free text
--                   crate like "C-7"). `location` stays as the legacy free text.
--   specs           free-text spec line (finish, polish, notes about the cut).
--   archived_at /   the SOFT reset. archiveYardForReset(reason) stamps every
--   archived_reason current row; nothing is deleted (a past incident deleted
--                   critical data — NEVER again). Every yard query excludes
--                   archived rows; the desktop Inventory tab shows them under
--                   a read-only "Old list (pre-reset)" so the 75 allocated
--                   family names stay visible as hints during the walk.
-- =============================================================================

alter table public.inventory_stock add column if not exists yard_tag        integer;
alter table public.inventory_stock add column if not exists zone            text;
alter table public.inventory_stock add column if not exists crate           text;
alter table public.inventory_stock add column if not exists specs           text;
alter table public.inventory_stock add column if not exists archived_at     timestamptz;
alter table public.inventory_stock add column if not exists archived_reason text;

-- One number per stone per tenant; rows without a number (the old list) are
-- free to stay null. Partial unique index = the mint race between two phones
-- fails loudly on the second insert and the helper re-mints the next number.
create unique index if not exists uq_inventory_stock_yard_tag
  on public.inventory_stock (tenant_id, yard_tag) where yard_tag is not null;

-- Every yard read is "live rows for this tenant" from now on.
create index if not exists idx_inventory_stock_live
  on public.inventory_stock (tenant_id) where archived_at is null;
