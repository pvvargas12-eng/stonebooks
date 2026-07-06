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

---

# ROUND 2 — Paul's follow-up decisions + test-data purge (same day)

**Cemeteries: 83 → 80. Orders: 364 → 351 (13 test orders deleted). Customers:
1224 → 1212 (12 test customers deleted). 9 test jobs deleted. Every deleted row
is snapshotted whole (full JSONB) in `_test_data_purge_log` (34 rows) —
recoverable if anything was wrong. 0 orphans after; no financial_records were
attached to anything purged (guarded — the purge would have aborted).**

## Decisions applied

- **Resurrection = Piscataway** — generic `Resurrection Cemetery` (8 orders,
  incl. the ex-"Resurrection" one) merged into `Resurrection Cemetery —
  Piscataway` → 9 orders. `— Toms River` demo row kept at 0 uses.
- **St. Peter & Paul ≠ St. Peter's Episcopal** — kept separate; `St. Peters`
  renamed to `St. Peter's Episcopal Cemetery` for clarity (logged).
- **E-26-0234 (cemetery "E")** — deleted per Paul; `E` cemetery row deleted.
- **E-26-0354 (Hillside / New Mt. Zion) KEPT** — it IS filled out: customer
  Helen Rech (Helenrech2000@yahoo.com), deceased Thomas & Jean, 1 job. Still
  needs the Hillside-vs-New-Mt.-Zion call (row still flagged).

## Test-order purge (13 orders, 9 jobs, 12 customers)

Signatures used: customer email pv.vargas12@gmail.com / pauly_vargas@outlook.com
/ `asdfasdf` / fake@email.com; DEMO/TEST/LEAD DEMO/V2/V3/V4 names; gibberish
(asdf/sdf) fields. Deleted orders: E-26-0234, 0238, 0239, 0244 (DEMO ACID WASH),
0246, 0261, 0272, 0274, 0291, 0292, 0302, 0303, 0304 (the ex-"Gerd" order —
its customer turned out to be LEAD DEMO V3). Deleted customers: 5× LEAD DEMO
variants, DEMO V3/DEMO ACID WASH, DEMOZV4/DEMO INSCRIPTION, DEMO V2/DEMOV2,
DEMO TEST, DEMO DEMO/TEST TEST TEST, and the Paul Vargas manual-test customer
(`bae19030`, pauly_vargas@outlook.com, 0 orders).

**Christ Cemetery resolved:** its only 2 orders were test entries (E-26-0272 /
0292, plot fields "sdf") — orders purged, row deleted. `Christ Church Cemetery`
(the real one, 2 imported in-production orders) stays. The earlier
Christ-vs-Christ-Church flag is CLOSED.

## Deliberately KEPT (matched a pattern but are real)

- **DAVID DEMORESKI** (NJDAV69@GMAIL.COM, Perth Amboy, 1 order) — surname
  contains "demo"; real customer.
- **Sonia Vargas** (Svponce61@gmail.com, draft E-26-0342) — shares the Vargas
  surname but real email/identity.
- No ZZ_DEMO-prefixed orders remain anywhere (prior demo-cleanup already
  handled them).

## Status: CLEANUP CLOSED (Paul, 2026-07-06)

Paul's final call: **leave the generic Hillside rows and their 20 orders as-is**
(no location assignment), and **leave E-26-0354 / the combined
"Hillside Cemetery / New Mt. Zion Cemetery" row untouched**. These are
deliberate keeps, not open items — do NOT re-flag them in future cleanups.
The specific rows (Hillside — Linden / Scotch Plains / Lyndhurst) remain
available in the picker if staff ever want them. Everything else — Christ,
St. Peter, Resurrection, E, Gerd, Ukr, test data — is CLOSED.
