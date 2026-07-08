-- ============================================================================
-- Stonebooks Trade polish round (Paul, 2026-07-08)
--   1. vendor_items.location        — plot/section location, next to base size
--   2. vendor_items.notes_align     — 'left' | 'center' (centered = inscription
--                                     preview look on the item notes box)
--   3. vendor_requests.submitted_by — which dealer teammate placed the order
--   4. partners.team_names          — jsonb string[] managed in Trade Settings,
--                                     rendered as pick-bubbles on the order form
--   5. vendor_po_items.unit_price   — per-line pricing for professional POs
-- All additive; RLS untouched (partners_partner_update already lets a dealer
-- update their own partners row, and the request/item partner policies cover
-- the new columns automatically — RLS is row-level, not column-level).
-- ============================================================================

alter table vendor_items    add column if not exists location text;
alter table vendor_items    add column if not exists notes_align text;
alter table vendor_requests add column if not exists submitted_by text;
alter table partners        add column if not exists team_names jsonb not null default '[]'::jsonb;
alter table vendor_po_items add column if not exists unit_price numeric;

-- Keep notes_align honest.
do $$ begin
  alter table vendor_items add constraint vendor_items_notes_align_check
    check (notes_align is null or notes_align in ('left', 'center'));
exception when duplicate_object then null; end $$;
