# Cemetery cleanup — FINAL EXECUTION REPORT (2026-07-06)

Executed per Paul's decisions + addendum. Every merge/delete is audited in
`_cemetery_merge_log` (28 rows, incl. per-row notes for the special cases);
the earlier Title Case pass is in `_cemetery_casing_log` (24 rows). Both intact.

**Cemetery rows: 109 before → 83 after** (28 duplicate/junk rows removed, 2
specific Hillside rows created). **Integrity verified: 0 orphaned orders, 0
orphaned batches; 294 orders carry a cemetery (none lost its assignment —
merges only re-point `cemetery_id`, deletes were guarded to zero references).**
`cemetery_orders` (door orders) is empty in prod, so no name-based door-order
references existed to rewrite.

## Merged (24 merge-log entries)

| Into | Merged sources (orders moved) | Result |
|---|---|---|
| St. Gertrude Cemetery | exact-dup row (1), Saint Gertrude Cemetery (3), Saint Gertrude (1), St. Gertrude (1), **Gerd (1 — Paul confirmed GERD = St. Gertrude)** | 27 orders |
| Alpine Cemetery | Alpine (1), **Alpine Cemetery Mausoleum (1 — addendum; mausoleum detail preserved in that order's plot pin notes)** | 63 orders |
| Mount Lebanon Cemetery | Mt. Lebanan typo (4), Mt. Lebanon Part 2 (2 — "Part 2" written to plot_section/pin notes first) | 16 orders |
| St. Vladimir's Cemetery | Saint Vladimir (1), St. Vlad (0), **Ukr (1 — customer Yaroslav Ivanchuk, E-26-0228; Ukrainian context per item 19)** | 8 orders |
| St. James Cemetery | Saint James (3), St. James (0) | 8 orders |
| Beth Israel Cemetery | Beth Israel (1) | 31 orders |
| Holy Cross Cemetery | Holy Cross (2) | 4 orders |
| Resurrection Cemetery | Resurrection (1) | 8 orders |
| Rosedale Cemetery | Rosedale (0), Roseda (0) | 11 orders |
| Clover Leaf Memorial Park | Clover (0) | 18 orders |
| St. Mary's Cemetery (real row `5a4fa706`) | seeded demo row `b0000000-…-0002` (1, by id), Saint Mary Cemetery (1) | 2 orders |
| Mount Calvary Cemetery — Linden | Mt. Calvary Cemetery (1 — **addendum: Paul confirmed same, both Linden-consistent**) | 2 orders |
| Hillside Cemetery (13-order row) | zero-use exact-duplicate row `2fb6ba03` (0 — housekeeping only, NOT a location decision) | — |

## Renamed (kept separate / normalized)

- `Fairview Cemetery — Westfield` (`750a1cc1…`) and `Fairview Cemetery — Staten Island` (`2def7953…`) — split kept per item 4.
- `Mount Calvary Linden` → `Mount Calvary Cemetery — Linden` (canonical per addendum).
- `Resurrection Cemetery Piscataway` → `Resurrection Cemetery — Piscataway`.
- Mojibake dashes fixed (real em-dash, chr 8212): `Hillside Cemetery — Linden`, `Resurrection Cemetery — Toms River` (both kept per items 3/12).

## Created

- `Hillside Cemetery — Scotch Plains`, `Hillside Cemetery — Lyndhurst` (canonical targets; 0 orders until classified).

## Deleted (0 references, guarded + logged)

- `Mount` (autocomplete fragment), `Cyrill` (fragment), `Holy Cross Cemetery — Edison` (seeded demo, item 11), `Ocean View Cemetery — Sea Bright` (seeded demo, item 13).

## Kept separate per Paul

- Green-Wood Cemetery vs Greenwood Memorial Park (item 14)
- Rosehill Cemetery vs Rosedale Cemetery (item 15)

## UNRESOLVED — needs Paul (nothing was merged here)

1. **Hillside generic rows — 20 orders with NO location evidence.** Neither
   generic row carries a region/geocode, and none of the 20 orders has an
   address or note naming Linden/Scotch Plains/Lyndhurst. Rows:
   - `03de015d…` (13): E-26-0008, 0012, 0028, 0037, 0050, 0057, 0156, 0168, 0195, 0196, 0250, 0251, 0287 — customers mostly Metuchen NJ.
   - `e465d9d5…` (7): E-26-0252, 0253, 0257, 0273 (all Okerson), 0283 (Decibus, section "Dogwood"), 0334 (Sylvester, section "Dogwood"), 0350 (Rak, section "St Francis", lot 8).
   The section names ("Dogwood", "St Francis") may tell you which cemetery this is.
   Once you say which location each row (or order) belongs to, I'll run
   `merge_cemetery_by_id` into the matching specific row.
2. **`E` (1 order)** — E-26-0234 is a cancelled draft with no customer, no
   deceased, no location. Can't identify the real cemetery. Options: reassign if
   you recognize it, or null its cemetery and delete the `E` row.
3. **`Hillside Cemetery / New Mt. Zion Cemetery` (1 order)** — E-26-0354,
   scoping, no context yet. Which cemetery is the job actually in?
4. **Christ Cemetery vs Christ Church Cemetery** — kept separate. Note: Christ
   Cemetery's 2 orders (E-26-0272, E-26-0292, customer in Farmingdale) look
   like TEST entries (plot fields are "sdf"). If they're junk, this whole row
   may be a delete, not a merge.
5. **St. Peter & Paul (E-26-0241, DELARATO) vs St. Peters (E-26-0256, Somerset customer)** —
   no shared context found; kept separate. If same, canonical would be
   `Sts. Peter and Paul Cemetery` per item 17.
6. **Resurrection Cemetery (8 generic orders)** — no order-level evidence they
   belong to Piscataway or Toms River; left generic per item 12.
7. **Presbyterian Cemetery (0 uses) vs First Presbyterian Metuchen (1)** — kept
   separate per item 16; nothing to merge unless you confirm they're the same.
8. **Beth El (1) / Beth Mordecai (1)** — not in scope; flagging only because they
   sit near Beth Israel alphabetically. No action taken.

## How to finish the flagged items

```sql
-- Hillside, once locations are known (example):
select public.merge_cemetery_by_id('03de015d-6d3c-4e9b-bc55-5fddadb8e66a',
       (select id from cemeteries where name = 'Hillside Cemetery — Scotch Plains'));
```
