-- DEMO-DATA-CLEANUP — reverse-UPDATE backup (generated 2026-05-28)
-- =============================================================================
-- Restores all 5 tables to their pre-cleanup state. Reverses the forward
-- UPDATEs in Phase C Transactions 1-5. Each table's reverse block is its own
-- BEGIN/COMMIT so you can selectively reverse a single table.
--
-- This file is local-only (not committed to GitHub by default — sits in
-- supabase/backups/ outside the migrations directory). If you ever need to
-- undo Phase C: paste this entire file into Studio SQL Editor and run it.
--
-- Companion in-DB snapshot: table `_backup_demo_rename_2026_05_28` holds the
-- same data as jsonb dumps; this SQL file is the explicit reverse path.
-- =============================================================================

-- ── CUSTOMERS (reverse) ─────────────────────────────────────────────────────
BEGIN;
UPDATE customers SET first_name='John',    last_name='ZZ_DEMO_Anderson'  WHERE id='a0000000-0000-4000-8000-000000000001';
UPDATE customers SET first_name='Maria',   last_name='ZZ_DEMO_Kowalski'  WHERE id='a0000000-0000-4000-8000-000000000002';
UPDATE customers SET first_name='Carlos',  last_name='ZZ_DEMO_Martinez'  WHERE id='a0000000-0000-4000-8000-000000000003';
UPDATE customers SET first_name='Linda',   last_name='ZZ_DEMO_Brennan'   WHERE id='a0000000-0000-4000-8000-000000000004';
UPDATE customers SET first_name='Robert',  last_name='ZZ_DEMO_Cohen'     WHERE id='a0000000-0000-4000-8000-000000000005';
UPDATE customers SET first_name='Sophia',  last_name='ZZ_DEMO_DiMaggio'  WHERE id='a0000000-0000-4000-8000-000000000006';
UPDATE customers SET first_name='James',   last_name='ZZ_DEMO_Edwards'   WHERE id='a0000000-0000-4000-8000-000000000007';
UPDATE customers SET first_name='Ana',     last_name='ZZ_DEMO_Fontana'   WHERE id='a0000000-0000-4000-8000-000000000008';
UPDATE customers SET first_name='Daniel',  last_name='ZZ_DEMO_Garcia'    WHERE id='a0000000-0000-4000-8000-000000000009';
UPDATE customers SET first_name='Hannah',  last_name='ZZ_DEMO_Hoffman'   WHERE id='a0000000-0000-4000-8000-000000000010';
UPDATE customers SET first_name='Ivan',    last_name='ZZ_DEMO_Ivanov'    WHERE id='a0000000-0000-4000-8000-000000000011';
UPDATE customers SET first_name='Julia',   last_name='ZZ_DEMO_Jensen'    WHERE id='a0000000-0000-4000-8000-000000000012';
UPDATE customers SET first_name='Karl',    last_name='ZZ_DEMO_Klein'     WHERE id='a0000000-0000-4000-8000-000000000013';
UPDATE customers SET first_name='Lara',    last_name='ZZ_DEMO_Lopez'     WHERE id='a0000000-0000-4000-8000-000000000014';
UPDATE customers SET first_name='Michael', last_name='ZZ_DEMO_Murphy'    WHERE id='a0000000-0000-4000-8000-000000000015';
UPDATE customers SET first_name='Nina',    last_name='ZZ_DEMO_Novak'     WHERE id='a0000000-0000-4000-8000-000000000016';
UPDATE customers SET first_name='Omar',    last_name='ZZ_DEMO_Ortiz'     WHERE id='a0000000-0000-4000-8000-000000000017';
UPDATE customers SET first_name='Petra',   last_name='ZZ_DEMO_Petrov'    WHERE id='a0000000-0000-4000-8000-000000000018';
UPDATE customers SET first_name='Quincy',  last_name='ZZ_DEMO_Quintero'  WHERE id='a0000000-0000-4000-8000-000000000019';
UPDATE customers SET first_name='Rosa',    last_name='ZZ_DEMO_Rossi'     WHERE id='a0000000-0000-4000-8000-000000000020';
UPDATE customers SET first_name='Stefan',  last_name='ZZ_DEMO_Schmidt'   WHERE id='a0000000-0000-4000-8000-000000000021';
UPDATE customers SET first_name='Tara',    last_name='ZZ_DEMO_Thompson'  WHERE id='a0000000-0000-4000-8000-000000000022';
UPDATE customers SET first_name='Ursula',  last_name='ZZ_DEMO_Underwood' WHERE id='a0000000-0000-4000-8000-000000000023';
UPDATE customers SET first_name='Viktor',  last_name='ZZ_DEMO_Volkov'    WHERE id='a0000000-0000-4000-8000-000000000024';
UPDATE customers SET first_name='Wendy',   last_name='ZZ_DEMO_Walsh'     WHERE id='a0000000-0000-4000-8000-000000000025';
COMMIT;

-- ── ORDERS (reverse) ────────────────────────────────────────────────────────
BEGIN;
UPDATE orders SET order_number='DEMO-001', primary_lastname='Anderson'  WHERE order_number='E-26-0019';
UPDATE orders SET order_number='DEMO-002'                               WHERE order_number='E-26-0020';
UPDATE orders SET order_number='DEMO-003'                               WHERE order_number='E-26-0021';
UPDATE orders SET order_number='DEMO-004'                               WHERE order_number='E-26-0022';
UPDATE orders SET order_number='DEMO-005'                               WHERE order_number='E-26-0023';
UPDATE orders SET order_number='DEMO-006'                               WHERE order_number='E-26-0024';
UPDATE orders SET order_number='DEMO-007'                               WHERE order_number='E-26-0025';
UPDATE orders SET order_number='DEMO-008'                               WHERE order_number='E-26-0026';
UPDATE orders SET order_number='DEMO-009'                               WHERE order_number='E-26-0027';
UPDATE orders SET order_number='DEMO-010'                               WHERE order_number='E-26-0028';
UPDATE orders SET order_number='DEMO-011'                               WHERE order_number='E-26-0029';
UPDATE orders SET order_number='DEMO-012'                               WHERE order_number='E-26-0030';
UPDATE orders SET order_number='DEMO-013'                               WHERE order_number='E-26-0031';
UPDATE orders SET order_number='DEMO-014'                               WHERE order_number='E-26-0032';
UPDATE orders SET order_number='DEMO-015'                               WHERE order_number='E-26-0033';
UPDATE orders SET order_number='DEMO-016'                               WHERE order_number='E-26-0034';
UPDATE orders SET order_number='DEMO-017'                               WHERE order_number='E-26-0035';
UPDATE orders SET order_number='DEMO-018'                               WHERE order_number='E-26-0036';
UPDATE orders SET order_number='DEMO-019'                               WHERE order_number='E-26-0037';
UPDATE orders SET order_number='DEMO-020'                               WHERE order_number='E-26-0038';
UPDATE orders SET order_number='DEMO-021'                               WHERE order_number='E-26-0039';
UPDATE orders SET order_number='DEMO-022'                               WHERE order_number='E-26-0040';
UPDATE orders SET order_number='DEMO-023', primary_lastname='Underwood' WHERE order_number='E-26-0041';
UPDATE orders SET order_number='DEMO-024'                               WHERE order_number='E-26-0042';
UPDATE orders SET order_number='DEMO-025'                               WHERE order_number='E-26-0043';
COMMIT;

-- ── CEMETERIES (reverse) ────────────────────────────────────────────────────
BEGIN;
UPDATE cemeteries SET name='ZZ_DEMO_Greenwood Memorial Park', city=''   WHERE name='Greenwood Memorial Park';
UPDATE cemeteries SET name='ZZ_DEMO_Hillside Cemetery',       city=''   WHERE name='Hillside Cemetery — Linden';
UPDATE cemeteries SET name='ZZ_DEMO_Holy Cross Cemetery',     city=''   WHERE name='Holy Cross Cemetery — Edison';
UPDATE cemeteries SET name='ZZ_DEMO_Ocean View Cemetery',     city=''   WHERE name='Ocean View Cemetery — Sea Bright';
UPDATE cemeteries SET name='ZZ_DEMO_Resurrection Cemetery',   city=''   WHERE name='Resurrection Cemetery — Toms River';
UPDATE cemeteries SET name='ZZ_DEMO_Riverside Memorial',      city=''   WHERE name='Riverside Memorial';
UPDATE cemeteries SET name=$$ZZ_DEMO_St Mary's Cemetery$$,    city=''   WHERE name=$$St Mary's Cemetery$$;
COMMIT;

-- ── WORK_BATCHES (reverse: title + notes back to original ZZ_DEMO_ values) ──
BEGIN;
UPDATE work_batches SET title='ZZ_DEMO_ Foundation pour — Hillside',                  notes='ZZ_DEMO_ tray: cluster foundation run'      WHERE id='e0000000-0000-4000-8000-000000000001';
UPDATE work_batches SET title='ZZ_DEMO_ Setting run — Resurrection',                  notes='ZZ_DEMO_ tray: stones ready to set'         WHERE id='e0000000-0000-4000-8000-000000000002';
UPDATE work_batches SET title='ZZ_DEMO_ Delivery — Greenwood (Edison)',               notes='ZZ_DEMO_ tray: mid-distance delivery'       WHERE id='e0000000-0000-4000-8000-000000000003';
UPDATE work_batches SET title=$$ZZ_DEMO_ Onsite inscription — St Mary's$$,            notes='ZZ_DEMO_ tray: in-place date carving'       WHERE id='e0000000-0000-4000-8000-000000000004';
UPDATE work_batches SET title='ZZ_DEMO_ Rubbing/measure — Holy Cross',                notes='ZZ_DEMO_ tray: measurements + rubbings'     WHERE id='e0000000-0000-4000-8000-000000000005';
UPDATE work_batches SET title='ZZ_DEMO_ Door/foundation — Riverside (Trenton)',       notes='ZZ_DEMO_ tray: far outlier door trip'       WHERE id='e0000000-0000-4000-8000-000000000006';
UPDATE work_batches SET title='ZZ_DEMO_ Acid wash batch (shop)',                      notes='ZZ_DEMO_ tray: shop block, no destination'  WHERE id='e0000000-0000-4000-8000-000000000007';
UPDATE work_batches SET title='ZZ_DEMO_ Blasting/stencil (shop)',                     notes='ZZ_DEMO_ tray: stencil + blast'             WHERE id='e0000000-0000-4000-8000-000000000008';
UPDATE work_batches SET title='ZZ_DEMO_ Repair bench work (shop)',                    notes='ZZ_DEMO_ tray: bench repair'                WHERE id='e0000000-0000-4000-8000-000000000009';
UPDATE work_batches SET title='ZZ_DEMO_ Setting — Ocean View (Toms River)',           notes='ZZ_DEMO_ tray: CANCELLED by customer'       WHERE id='e0000000-0000-4000-8000-000000000010';
UPDATE work_batches SET title='ZZ_DEMO_ Foundation trip — Perth Amboy cluster',       notes='ZZ_DEMO_ multi-stop cluster run'            WHERE id='e0000000-0000-4000-8000-000000000011';
UPDATE work_batches SET title='ZZ_DEMO_ Delivery run — Edison',                       notes='ZZ_DEMO_ morning delivery'                  WHERE id='e0000000-0000-4000-8000-000000000012';
UPDATE work_batches SET title='ZZ_DEMO_ Setting — Resurrection',                      notes='ZZ_DEMO_ afternoon set'                     WHERE id='e0000000-0000-4000-8000-000000000013';
UPDATE work_batches SET title='ZZ_DEMO_ Acid wash (shop)',                            notes='ZZ_DEMO_ shop block'                        WHERE id='e0000000-0000-4000-8000-000000000014';
UPDATE work_batches SET title='ZZ_DEMO_ Blasting day (shop, all-day)',                notes='ZZ_DEMO_ all-day, unslotted'                WHERE id='e0000000-0000-4000-8000-000000000015';
UPDATE work_batches SET title='ZZ_DEMO_ Foundation trip — Trenton (outlier)',         notes='ZZ_DEMO_ far outlier — long route'          WHERE id='e0000000-0000-4000-8000-000000000016';
UPDATE work_batches SET title='ZZ_DEMO_ Repair bench (shop)',                         notes='ZZ_DEMO_ shop block'                        WHERE id='e0000000-0000-4000-8000-000000000017';
UPDATE work_batches SET title='ZZ_DEMO_ Setting — Ocean View (all-day, outlier)',     notes='ZZ_DEMO_ all-day far-outlier set'           WHERE id='e0000000-0000-4000-8000-000000000018';
UPDATE work_batches SET title='ZZ_DEMO_ Delivery — Woodbridge',                       notes='ZZ_DEMO_ morning delivery'                  WHERE id='e0000000-0000-4000-8000-000000000019';
UPDATE work_batches SET title='ZZ_DEMO_ Setting — Hillside',                          notes='ZZ_DEMO_ afternoon set'                     WHERE id='e0000000-0000-4000-8000-000000000020';
UPDATE work_batches SET title='ZZ_DEMO_ Site visit / estimate — Edison',              notes='ZZ_DEMO_ event: customer estimate, no jobs' WHERE id='e0000000-0000-4000-8000-000000000021';
UPDATE work_batches SET title='ZZ_DEMO_ Errand — supplier pickup',                    notes='ZZ_DEMO_ event: parts pickup, no jobs'      WHERE id='e0000000-0000-4000-8000-000000000022';
UPDATE work_batches SET title=$$ZZ_DEMO_ Setting — St Mary's (LATE)$$,                notes='ZZ_DEMO_ overdue: never completed'          WHERE id='e0000000-0000-4000-8000-000000000023';
UPDATE work_batches SET title='ZZ_DEMO_ Delivery — Edison (slipped)',                 notes='ZZ_DEMO_ started, not finished'             WHERE id='e0000000-0000-4000-8000-000000000024';
UPDATE work_batches SET title='ZZ_DEMO_ Setting — Hillside (done)',                   notes='ZZ_DEMO_ completed on time'                 WHERE id='e0000000-0000-4000-8000-000000000025';
COMMIT;

-- ── JOB_PROMISES (reverse: notes back to original ZZ_DEMO_ values) ──────────
BEGIN;
UPDATE job_promises SET notes='CRACKED UNDER PRESSURE DURING CALL'              WHERE id='88c41822-b224-480c-a712-69b134cdd1b4';
UPDATE job_promises SET notes='ZZ_DEMO_ overdue: promised install date passed'  WHERE id='e2000000-0000-4000-8000-000000000001';
UPDATE job_promises SET notes='ZZ_DEMO_ overdue: customer waiting'              WHERE id='e2000000-0000-4000-8000-000000000002';
UPDATE job_promises SET notes='ZZ_DEMO_ overdue: rush order slipped'            WHERE id='e2000000-0000-4000-8000-000000000003';
UPDATE job_promises SET notes='ZZ_DEMO_ overdue: veteran ceremony date'         WHERE id='e2000000-0000-4000-8000-000000000004';
UPDATE job_promises SET notes='ZZ_DEMO_ overdue: just missed promise'           WHERE id='e2000000-0000-4000-8000-000000000005';
UPDATE job_promises SET notes='ZZ_DEMO_ kept: delivered on time'                WHERE id='e2000000-0000-4000-8000-000000000006';
UPDATE job_promises SET notes='ZZ_DEMO_ kept: completed early'                  WHERE id='e2000000-0000-4000-8000-000000000007';
UPDATE job_promises SET notes='ZZ_DEMO_ upcoming: promised next week'           WHERE id='e2000000-0000-4000-8000-000000000008';
COMMIT;
