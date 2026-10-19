-- =============================================================================
-- RESET-TAG-1b (2026-10-19) — per-type stone specs, condition, exact spot
-- =============================================================================
-- Paul: the stone record carries the SAME words as the contract line, so the
-- phone's chips reuse the catalog constants the wizard / OrderForm use
-- (monumentCatalog TOP_SHAPES + POLISH_LEVELS, orderRates BASE_FINISHES,
-- baseConfig.topFinish pol/frost, baseConfig.polishMargin2in), plus a
-- condition on every save and a free-text spot so the row answers "where
-- exactly" (stack 3, row 2, by the gate).
--
-- COLUMN MAPPING (inventory_stock):
--   top           (existing) DIE FAMILY: the TOP_SHAPES code (classic-serp,
--                 flat-top, roof-top, oval-top, cathedral, gothic,
--                 cathedral-serp). Legacy rows keep whatever free text the
--                 importer wrote ("Polished") — a non-code value renders as is.
--   polish_level  DIE FAMILY: the POLISH_LEVELS code (P1 / P2 / P3 / P5 /
--                 steel-top / frosted-top) = order.polish_level.
--   finish        BASE: the BASE_FINISHES code (SB / RB / BRP / AP / AS)
--                 = baseConfig.finish.
--   top_finish    BASE: 'pol' | 'frost' = baseConfig.topFinish.
--   polish_margin BASE: the 2" polished margin = baseConfig.polishMargin2in.
--   sides, back   (existing) legacy free text from the importer — untouched.
--   specs         anything else, free text ("Pol Top; Saw Back", a cut note).
--   condition     good (default) / chip / crack / scratch / wrong_size / other.
--                 A condition other than good is a pill on the row; it does NOT
--                 make the stone a problem — status 'problem' (red tape) is a
--                 separate, explicit action.
--   condition_note  free text ("small chip back lower left").
--   damage_photo_url  optional photo of the damage (same bucket as photo_url).
--   spot          free text within the zone/crate ("stack 3", "row 2").
-- =============================================================================

alter table public.inventory_stock add column if not exists polish_level     text;
alter table public.inventory_stock add column if not exists finish           text;
alter table public.inventory_stock add column if not exists top_finish       text;
alter table public.inventory_stock add column if not exists polish_margin    boolean not null default false;
alter table public.inventory_stock add column if not exists condition        text not null default 'good';
alter table public.inventory_stock add column if not exists condition_note   text;
alter table public.inventory_stock add column if not exists damage_photo_url text;
alter table public.inventory_stock add column if not exists spot             text;
