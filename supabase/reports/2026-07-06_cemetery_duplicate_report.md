# Cemetery cleanup — duplicate-candidate report (2026-07-06)

**Status: AWAITING PAUL'S PER-PAIR DECISIONS. No merges have been performed.**

The Title Case pass already ran (24 names fixed, all logged in `_cemetery_casing_log`
with before/after). Detection used pg_trgm similarity + Levenshtein + substring
matching over normalized names (suffix words stripped, `Mt`→`Mount`, `St`→`Saint`).

"Uses" = orders (by `cemetery_id`) + scheduled batches + cemetery door orders (by name).
Permit-log rows live on orders, so order counts cover the Permit Hub too.

## How to merge an approved pair

Run in Supabase Studio (functions are already installed, defined by
`supabase/migrations/20260706_cemetery_casing_cleanup.sql`):

```sql
-- name-based (moves ALL rows with from_name into to_name, then removes them):
select public.merge_cemetery('Mt. Lebanan', 'Mount Lebanon Cemetery');

-- id-based (for rows that share the SAME name — see section 1):
select public.merge_cemetery_by_id('<from_id>', '<to_id>');
```

Every merge writes an audit row to `_cemetery_merge_log`.

---

## 1. Exact-name duplicates (same name, multiple rows) — id-based merge needed

| Name | Rows | Uses per row | Suggested action |
|---|---|---|---|
| Hillside Cemetery | 3 | 13 / 7 / 0 | Likely one real cemetery → keep `03de015d-6d3c-4e9b-bc55-5fddadb8e66a` (13 uses); merge `e465d9d5-f6e4-4874-8301-c8e9f2cbf73c` (7) and `2fb6ba03-e57b-45e0-a368-ac0a43f3eb77` (0) into it. NOTE: there may genuinely be two Hillsides (see the "Hillside Cemetery — Linden" row below) — confirm before merging. |
| Fairview Cemetery | 2 | 0 / 0 | Known collision from CLAUDE.md: one is Westfield NJ, one Staten Island NY. Recommend RENAME to "Fairview Cemetery — Westfield" / "Fairview Cemetery — Staten Island" (keep separate). Ids: `750a1cc1-3ed4-4c18-aa28-b64bae58106f`, `2def7953-b2a3-4d30-969a-db6c465dc8fc`. |
| St. Gertrude Cemetery | 2 | 20 / 1 | Same place → merge `f416738f-4dd3-412a-823a-b262ebf429b3` (1) into `3bba320f-fa56-43c3-bf2d-ea67beb4c7e2` (20). |
| St. Mary's Cemetery | 2 | 1 / 0 | Merge `5a4fa706-afeb-4720-b75b-5c4c8e3e4d2c` (0) into `b0000000-0000-4000-8000-000000000002` (1) — or the reverse; the b0000000 id is a seeded demo row, so keeping the real one may be cleaner. |

## 2. High-confidence variants (same place, different spelling)

| Keep (more used) | Merge in | Uses |
|---|---|---|
| Alpine Cemetery (61) | Alpine | 1 |
| Beth Israel Cemetery (30) | Beth Israel | 1 |
| St. Gertrude Cemetery (20) | Saint Gertrude Cemetery / Saint Gertrude / St. Gertrude | 3 / 1 / 1 |
| Mount Lebanon Cemetery (10) | Mt. Lebanan *(typo)* | 4 |
| Rosedale Cemetery (11) | Rosedale / Roseda | 0 / 0 |
| Resurrection Cemetery (7) | Resurrection | 1 |
| St. Vladimir's Cemetery (6) | Saint Vladimir / St. Vlad | 1 / 0 |
| St. James Cemetery (5) | Saint James / St. James | 3 / 0 |
| Holy Cross Cemetery (2) | Holy Cross | 2 |
| Clover Leaf Memorial Park (18) | Clover | 0 |
| St. Mary's Cemetery | Saint Mary Cemetery | 1 |

## 3. Paul's judgment needed (may be genuinely different places)

| Pair | Notes |
|---|---|
| Alpine Cemetery vs Alpine Cemetery Mausoleum | Mausoleum section of the same grounds, or worth keeping separate for door work? |
| Mount Lebanon Cemetery vs Mt. Lebanon Part 2 | "Part 2" looks like a section, not a separate cemetery. |
| Mount Calvary Linden vs Mt. Calvary Cemetery | Same Linden location? 1 use each. |
| Christ Cemetery vs Christ Church Cemetery | 2 vs 3 uses (1 batch on Christ Church). |
| Hillside Cemetery vs Hillside Cemetery — Linden | The Linden row is seeded demo data (`b0000000-…-0001`, name carries a mojibake dash: `â`). If the real Hillside IS the Linden one, fix the name and merge; otherwise delete the demo row. |
| Holy Cross Cemetery vs Holy Cross Cemetery — Edison (`b0000000-…-0004`, mojibake dash) | Seeded demo row, 0 uses. |
| Resurrection Cemetery vs Resurrection Cemetery — Toms River (`b0000000-…-0003`) vs Resurrection Cemetery Piscataway | Three candidates; Piscataway (1 use) may be a real distinct location. |
| Ocean View Cemetery vs Ocean View Cemetery — Sea Bright (`b0000000-…-0007`) | Seeded demo row, 0 uses each. |
| Green-Wood Cemetery vs Greenwood Memorial Park | Brooklyn's Green-Wood vs a NJ memorial park — probably KEEP SEPARATE. |
| Rosehill Cemetery vs Rosedale Cemetery | Different places (Linden vs Orange) — probably KEEP SEPARATE. |
| Presbyterian Cemetery vs First Presbyterian Metuchen | Possibly different congregations. |
| St. Peter & Paul vs St. Peters | 1 use each. |
| Hillside Cemetery / New Mt. Zion Cemetery | A combined free-text entry (1 use) — probably belongs to one of the Hillside rows. |

## 4. Junk rows (typos / test entries — decide: fix, merge, or delete)

| Name | Uses | Note |
|---|---|---|
| E | 1 order | Single-letter test entry — the order needs a real cemetery. |
| Gerd | 1 order | Was "GERD". Unknown — check the order. |
| Ukr | 1 order | Was "UKR" — probably St. Vladimir's (Ukrainian)? Check the order. |
| Mount | 0 | Abandoned autocomplete fragment. |
| Cyrill | 0 | Fragment of "St. Cyrillus and Methodius". |
| Clover / Roseda / St. Vlad / St. James | 0 | Fragments — safe merges/deletes per section 2. |

Also flagged: four `b0000000-…` seeded demo cemeteries carry a mojibake `â` where
an em-dash should be. If kept, fix the character; if not, they're 0-use deletes
(except confirm none is the "real" location of its family).
