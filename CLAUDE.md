# Stonebooks CRM — Shevchenko Monuments

## INCIDENT (2026-07-21 ~19:20-19:43 UTC): Supabase project wedged — RESOLVED by project restart

Symptom: "Stonebooks isn't opening / never signs in" in EVERY browser. Diagnosis ladder that worked: (1) site HTML + chunks 200 ✓; (2) unkeyed /auth/v1/health + /rest/v1/ → instant 401 (gateway alive); (3) SAME endpoints WITH the anon apikey → HTTP 000 timeouts (services behind gateway hung); (4) Management API SQL → "Connection terminated due to connection timeout" (the DATABASE itself unreachable); (5) status.supabase.com → all operational (so OUR instance, not platform). Remedy: **POST https://api.supabase.com/v1/projects/ibekfollqnytxcuyekad/restart** (Bearer = same Credential Manager token as sb-api; scratchpad sb-restart.ps1 pattern) → HTTP 200 → back in under a minute, zero data loss (453 orders, 36 templates verified). "Failed to fetch" on sign-in = the reboot window.
- Post-restart baseline: 31/60 pg connections (22 idle pools), db 4754 MB, no long-lived conns. Root cause unproven (stats reset) — suspected connection pile-up under heavy day load. If it recurs: check pg_stat_activity FIRST (count/state/oldest), then restart; consider compute upgrade if repeated.
- Note: the app anon key is the NEW sb_publishable_* format (46 chars) in .env.local — bundle-grepping for 'eyJ' finds nothing.

## Sprint FIELD-FLOOR (2026-07-23) — SHIPPED: the phone FLOOR tab is the real component floor

Commit 9f8346b, Production success. Paul walking the shop with Collin: "i need to adjust these production queues on the field app... start with blast, i'll add every order to that list. same for the others." He'd flagged TWICE that the old field production screen (stone-ladder lanes: To order/In shop/Blasted/Foundation) wasn't his steps — those lanes are retired.

- **`src/field/ProductionFloorScreen.jsx` rewritten** on the desktop ProductionBoard's exact substrate: getProductionComponents + getBringUpReady, advance/reverse/setComponentOnFloor(+overrideComponentPhase for add-undo)/qcApprove/qcDeny/clearComponentQcIssue — writes stamp `source:'field'`, actor = the phone's picked person (who.name).
- **IA:** track chips (NEW STONE/INSCRIPTION/BRONZE/DOORS, white = on-floor count, red = ready-to-add count) → phase bucket tiles (first bucket shows "N ready to add" red) → bucket list: ADVANCE/BACK verbs with the field-standard 8s undo (inverse op; add-undo returns to queue + restores prior phase), QC APPROVE/DENY-with-typed-issue/CLEAR ISSUE on quality_check (new_stone + door), HELD/BLOCKED chips, OPEN → job drill. **+ ADD per bucket** = fl-sheet over the queue, ready pieces first wearing the DESIGN/STONE/CONTRACTED condition chips (fl-c-good/warn/bad).
- Hand-picked doctrine holds on the phone: the + ADD sheet is the only way pieces reach the floor.
- **Tab availability:** FLOOR is default for Production/Installation departments; owner reaches it via MORE → "Not in your bar" or adds it in Settings → Staff → tabs (not ownerOnly — no registry change needed).
- **Install flow verified, not changed:** Jobs → Installations (14-day batches) → stop → JobDetail → Finish: camera upload, "Mark installed" gated on ≥1 completion photo, undoable. Paul called this critical — it was already built (FIELD-MODE) and confirmed wired.

## Sprint BRING-UP-ALERT (2026-07-23) — SHIPPED: floor bring-up recommendations + cut-list stone-up alarm

Commit bc5c8c3, Production success. Paul's conditions, verbatim: "for recommended things to bring up the conditions are design approved, stone arrived or in stock, contracted... then i want alerts for things that are ready or like stone is up but stencil is not cut."

- **`getBringUpReady()`** (stonebooksData, by countCutReady): ALL queued job-linked pieces (v2, same day — Paul: "thats how i want it for all of them in this production tab section") where **design approved** (proof_approved OR bronze_proof_approved milestone done OR current proof.approved_at) + **stone here** (stone_received OR stone_in_stock done; NO stone keys — inscriptions/bronze/doors — skip the gate) + **contracted** (isRealWork via shared `_filterRealWorkJobIds`, chunked .in(150); drafts/leads excluded per standing doctrine). Returns `{count, readyByTrack, byJob}` — count = total ready PIECES (Jobs-tab badge), readyByTrack drives the per-track red numbers, byJob {contracted, designOk, stoneOk, hasStoneKey, ready} drives row chips.
- **ProductionFloor board (v2 — Paul rejected the v1 top section same day)**: the first column of every track ("Ready to Bring Up" etc.) keeps the WHITE count = pieces on the board, plus a **red pulsing number = queued pieces meeting the conditions**; clicking it opens the + Add picker with ready rows first (green-ringed, hint line). Same red count on each track chip. Queue log + add picker rows wear **condition chips** mirroring the Orders-table dropdowns (DESIGN APPROVED / STONE HERE / CONTRACTED green; missing → amber; NOT CONTRACTED red; trade pieces with no job get none). Header purpose line documents the two numbers. **Hand-picked rule intact — the numbers nag, Paul pulls.** Ship-time per-track audit: new_stone 35, inscription 8, bronze/door 0.
- **`getStoneUpByJob()`**: on_floor new-stone pieces at brought_to_line/cut (physically up, pre-stencil). **CutListBoard**: those jobs with stencil_cut open + not listed alert REGARDLESS of gates (reality outranks paperwork) — top-billed in the red section with pulsing "STONE IS UP — stencil not cut", red STONE IS UP chip in gateChips (picker + list rows), subtitle + red KPI updated. `countCutReady` unions them into the Jobs-tab Cut list badge.
- **JobsTab strip**: Production tab now carries a red badge = getBringUpReady().count (mirrors the cutlist badge pattern, same effect).
- **Ship-time audit (Management API, read-only)**: 32 jobs met the bring-up conditions; **Merciadez** was the one stone-up-not-cut — exactly the card Paul's screenshot showed at Brought to Line. Trade pieces (job_id NULL, e.g. Media) can't ride the cut list — it's a jobs surface; acceptable.
- Scratchpad gotcha for future prod SQL: `ConvertTo-Json` on `Get-Content -Raw` output serializes the PSObject wrapper (`{"query":{"value":...}}` → API 400 "Expected string, received object") — interpolate `"$sql"` into the hashtable first. And keep .ps1 files ASCII-only (em-dashes break PS 5.1's BOM-less read).

## Fix ceeffb2 (2026-07-22, round 10) — customer-save crash + OrderDetail top Delete

OrderDetail's Customer & Contact quick-edit sent `referral_source` to the CUSTOMERS table — it's a JOBS column (the exact trap customerToRow documents) — so PostgREST rejected the whole save and names couldn't be fixed. The editor now seeds Funeral home / referral FROM the job and writes back via new `setJobReferralSource` (stonebooksData); rest of the draft → customers; the contact card's referral display reads the job too (the customers read was always blank; leads with no job simply don't persist the field). Plus a red **Delete** in the top quick-action row opening the EXISTING permanent-delete modal (it only lived in the bottom danger zone — Paul couldn't find it on a blank lead).

## Sprint CUT-LIST (2026-07-22, round 9) — SHIPPED: the hand-built stencil queue + red not-queued alert

Commit ba9f4ac, Production success. Migration `20260722_stencil_cut_list.sql` ✅ APPLIED + verified (foundation_list mirror: membership only, job_id unique CASCADE, 3-role RLS). Paul's doctrine, again: "I don't want to auto add to production — I already told you I want to build my lists."

- **Jobs › Cut list** (JOBS_TABS after Production) — `src/CutListBoard.jsx`: readiness = **stone_received done (jobs with NO stone_received milestone — inscriptions — skip that gate) AND layout approved** (designStateFor 'approved' OR proof_approved milestone OR current proof approved_at). Picker adds ANY uncut job (has an open stencil_cut milestone), amber gate chips STONE NOT HERE / LAYOUT NOT APPROVED — gates inform, never wall.
- **The red notification**: pulsing red section on the board listing eligible-but-unqueued stones (one-click Add each) + a red count badge on the Jobs tab strip via `countCutReady()` (3 light queries: job_milestones in (stencil_cut, stone_received) + getCurrentProofsByJob + the list — no getJobs; badge approximates layout-approved as proof.approved_at, the board shows the full read).
- **MARK CUT** = `setOrderStoneStatus(job, 'needs_blasting')` (flips stencil_created + stencil_cut done, vocabulary-aware) + optimistic local plan apply (`applyPlanLocally`, the FoundationsBoard pattern). Cut rows stay listed (dimmed, CUT chip) until removed.
- NOT built (flagged): cut-ready surfacing on Today / field push; drag reorder (sort_order column exists).
- **Fix befad24 (same night): drafts/leads HARD-EXCLUDED** — `isRealWork` (post-contract status, not archived/terminal, AND rowTotalPaid > 0 — the LEAD-no-deposit rule) gates the pool/picker/alert outright, countCutReady fetches candidate orders and applies the same rule, and a draft already ON the list renders a red "DRAFT / LEAD — not production work" chip with only Remove. **STANDING DOCTRINE: drafts and leads never appear on production work lists** — apply isRealWork-equivalent gates to any future production queue.

## Sprint NAMES-2 (2026-07-22, round 8) — SHIPPED: stored names cleaned + casing normalized at the door

Commit e220a57. Paul's go: "some people write in all caps others dont and it makes it sloppy… also all over with cemetery names."

- **One-time prod cleanup (logged, guarded):** `_name_casing_log` table (2,485 before/after rows) — 1,062 customers (first/last), 295 orders' deceased jsonb (first/middle/last; primary_lastname regenerated itself), 5 more cemeteries (round 2: broken-mixed + all-lower), 0 cemetery_order snapshots needed. Ran via scratchpad `names-cleanup.mjs` (Node computes with the EXACT properName port; token via env from Credential Manager; updates guarded on prior values so concurrent edits are skipped not clobbered; chunked through the Management API — ~10 min run). Verified: **0 shouty order families / 1 "shouty" customer left = last_name "III"** (correctly protected suffix). O'LEARY→O'Leary, D'ARCY→D'Arcy recovered properly.
- **Save-time guard:** `customerToRow` first/last + `orderToRow` deceased (via `normalizeDeceasedNames`) run properName on EVERY save — all-caps typing lands clean and re-saves self-heal any strays. **inscriptionName (carved) is deliberately untouched.**
- Keep the properName port in names-cleanup.mjs in sync if properName's shapes ever change (it's a scratchpad one-shot; the canonical logic lives in stonebooksData).

## Sprint NAMES-1 + CAL-2 fixes (2026-07-22, round 7) — SHIPPED: hESS → Hess everywhere + the month grid can't merge days

Commits a4fc151 + 4985f28 (calendar grid: minmax(0,1fr) columns, then 1px-gap tile grid + overflow:hidden per cell — chips truncate, days can never bleed into neighbors; verified vs a rebuild of Paul's July screenshot at desktop width) and b038733 (**properName rewritten** — the old guard skipped ALL mixed-case so hESS/KOVALESKi passed raw; now per-word well-formed shapes are kept (Hess, Smith-Jones, Mc/Mac, O'/D', De/Di/La/Van…, II/III/IV) and everything else normalizes to capital-first; 23-case node test in-session. Display-only, data untouched. Raw sites wrapped: Calendar, Cemeteries tab + field screen, Reconcile, Permit Builder; OrdersTab/DesignHub inherit; the field app's deliberate ALL-CAPS family styling kept). Ukrainian Cemetery → St Vladimir merge was run BY PAUL via the tab tool.

## Sprint CEM-4 (2026-07-22, round 6) — SHIPPED: add cemetery, dup panel tamed, template-twin fix + Borodin diagnostic

Commit 5a8bd5a, Production success. (a) **+ New cemetery** modal (createCemetery: ilike reuse + shouty-only auto-case via a private _titleCaseCem copy in stonebooksData — import-cycle avoidance, keep in sync with SalesMode's local twin). (b) **Dup panel collapsed by default** behind an amber count pill; per-group **Ignore** persisted in localStorage `sb_cem_dup_ignored` (per-browser — fine, Paul is the user) + reset link. (c) **Template twins**: Paul's cemetery-row merges (Beth Israel, St. Gertrude) left PB-2's dup-copied templates BOTH on the keeper → the 6-button Build pick. Fixed in prod (4 templates archived, RETURNING-verified) and **mergeCemeteries now self-dedupes identical-title actives post-merge** (most permit_docs wins, tie → oldest). (d) **Borodin diagnostic (E-26-0356)**: NOT a Stonebooks error — the UKRAINIAN CEMETERY row (58e85073) was created 2026-06-03 by data entry, the order assigned at intake 06-30; all automation postdates it. **9 orders sit on that row** (Ivanchuk/Mackiewicz/Borodin contracted, Kosich/Lazareva cancelled, 1 closed, 3 drafts). Ukrainian→St Vladimir merge is PAUL'S one-click call in the tab (St Vlad row 8a169760 carries the permit template). NOTE someone renamed the row back to all-caps "UKRAINIAN CEMETERY" today — tab edits don't auto-case (only create does), deliberate.

## Sprint CAL-2 (2026-07-22, round 5) — SHIPPED: the Calendar tab rebuilt

Commit 77cc2b8, Production success. Migration `20260722_calendar_reminders.sql` ✅ APPLIED + verified. **`src/CalendarTab.jsx` (new) now owns the Calendar tab** — SchedulerTab's `variant="calendar"` surface is retired from the nav (code intact, Scheduler tab untouched; same work_batches/shop_tasks/orders data layer, no parallel store).

- **Layers** (localStorage-persisted): Runs & events / Task due dates / Order due dates / Reminders. Month + Week views (view persisted too).
- **Add stays in view** (Paul's complaint: adding always bounced to week): + Event header button (today), hover + on any day cell, or from the day peek — creates a zero-job work_batch (site_visit/errand) via createBatch, so the Scheduler sees it.
- **Drag anything to any day = date override**: batch scheduled_date / task due_date (updateShopTask dueDate) / order target_completion_date (new setOrderTargetDate — NOTE this moves the CONTRACT-facing due date, per Paul "wherever its dragged that date is override") / reminder remind_on. Optimistic + 8s UNDO toast.
- **Reminders board** (`calendar_reminders`, one row PER FIRING): composer offers on-the-day/1d/3d/1w/2w/1m/2m-before + any exact dates, from any item's REMIND ME (day peek) or standalone. Due (remind_on ≤ today, unacknowledged) rows are unmissable — red board + pulsing jump pill by the filters — and each stays until ACKNOWLEDGE stamps acknowledged_at/by. Upcoming = quiet list, undoable remove. Order-sourced reminders carry Open-order (source_type/source_id).
- Look: cream/gold/near-black, Fraunces-serif masthead (falls back Georgia), dark DOW band, gold today ring, type-colored chips (runs near-black/gold, tasks blue, order-due red, reminders gold).
- NOT built (flagged for later): reminders surfaced on Today/field push; recurring events; weather strip on the new month view.

## Sprint CEM-3 (2026-07-22, round 4) — SHIPPED: snap-run map capture, grave pins, install history, auto-casing

Commit e54cb79, Production success. Migration `20260722_cemetery_map_pins.sql` ✅ APPLIED + verified (table, 3 policies, 4 indexes).

- **Phone snap-run** (CemeteriesScreen): "Snap map pages" → camera; each shot uploads as `Page N` and the camera REOPENS (requestAnimationFrame → input.click(); a persistent bar with Snap-next/Done is the fallback where browsers block programmatic re-open — iOS may or may not allow it, the bar always works). Thumb rows show grave-pin counts.
- **Grave pins** — `cemetery_map_pins` (cemetery_id + map_id + order_id all CASCADE, fractional x/y, label = family at drop time). **Visibility is READ-time in `listMapPins`: pins whose order is closed/cancelled/archived are filtered out** — closing an order clears its pins everywhere (Paul's rule), reopening restores them, hard delete cascades. Desktop `PinViewer` (pick open order → click map → pin; click pin → Open order / Remove) + field `MapPinViewer` (DROP A GRAVE PIN → whose grave → tap map, 8s undo deletes; tap pin → OPEN ORDER via onOpenJob). Overlay math: wrapper div = img box (img width:100% height:auto in a scroll container), dots at x/y×100% with translate(-50%,-100%).
- **Install history** on the desktop detail (listInstallHistoryAtCemetery: status installed/closed, archived INCLUDED — history wants the old stuff), click-through with the Cemeteries return context.
- **Auto-casing at create**: `titleCaseCemeteryName` local to SalesMode's `upsertCemetery` insert branch — normalizes ONLY all-caps/all-lowercase input (St./Mt. periods, small connectors lowercase); mixed case ("McClellan") passes through. The ilike lookup-or-create still matches case-insensitively, so shouty input reuses existing rows instead of duping.

## Sprint CEM-2 (2026-07-22, round 3) — SHIPPED: cemetery merge + dup finder + work cards; ALL-CAPS names fixed in prod

Commit 2996574, Production success. (a) **Merge** from the Cemeteries tab: modal (keeper + duplicate, swap direction, live counts of what moves), `mergeCemeteries` re-points ALL FIVE referencing tables client-side — orders / permit_templates / **permit_docs (FK-less!)** / cemetery_maps / work_batches.destination_cemetery_id (the 2026-07-06 `merge_cemetery_by_id` SQL fn predates the permit/maps tables — do NOT use it; `CEMETERY_REFS` in stonebooksData is the canonical list, extend it when a new cemetery_id column appears). Blank-fills keeper info from the duplicate, appends its notes, deletes the duplicate LAST (mid-way failure = both rows intact, re-runnable). (b) **Possible-duplicates panel** (normalized scent: Saint→St, Mount→Mt, suffix words dropped; conservative — typos like "Fairview West Feild" merge by hand via the detail's Merge… button). (c) **Work here card**: open orders/leads at the cemetery (click-through with Back → Cemeteries) + bound permit templates. (d) **Prod data fix, logged**: 22 ALL-CAPS names title-cased via the existing `title_case_cemetery()` (before/after in `_cemetery_casing_log`); junk rows surfaced for Paul ("Pick Up Sending To Jamaica", "Ukr", the Fairview triplet) — HIS call to merge/delete, not auto-fixed.

## Sprint CEM-1 + PB-6 + HUB-2 (2026-07-22, same day round 2) — SHIPPED: cemetery hub, permit editor UX, design hub upgrades, reconcile delete + layout catch-up

Commit d2fa548, Vercel Production success. Migration `20260722_cemetery_hub.sql` ✅ APPLIED + verified (5 cemetery columns, cemetery_maps, 3 policies). Eight Paul directives:

- **CEMETERIES TAB (new, NAV after Permit Builder)** — `src/CemeteriesTab.jsx`: roster (search, map counts, pin badge) + detail: editable info (name/address/city/state/zip/phone/email/website/notes via updateCemeteryPermit), **Drive link**, **manual PIN** (paste "lat, lng" from Google Maps; pin > geocode > address everywhere), **map pages** — multi-file upload (label seeds from filename, edit on the card, blur saves), full-size viewer, per-page delete w/ confirm. Data: `cemeteries.drive_link/pin_lat/pin_lng/pin_set_by/pin_set_at` + `cemetery_maps` (cemetery_id CASCADE, image_url, storage_path, label, sort_order; storage under `orders-attachments-public/cemetery-maps/<id>/`). Helpers: list/add/update/delete CemeteryMap + countCemeteryMaps (one-query badges).
- **Field CEMETERIES (More tile, CREW-CAPABLE)** — `src/field/CemeteriesScreen.jsx`: search → detail: **GO TO** (maps.apple daddr to the pin, else directionsUrl), Call office, Drive folder, map pages (thumb rows → fl-zoom-overlay full screen), **"Mark the location (I am here)"** (GPS → pin write + 8s undo), **"Mark a grave"** — open orders/leads at that cemetery (statuses draft…paid_in_full, SPOT MARKED chip) → the exported `MarkSpotForm` from JobDetailScreen (GPS+note+photo → orders.field_location + attachment).
- **Permit editor UX (Paul: "easier font size… see exactly how it will look… select all boxes")** — root cause: template-mode key labels rendered at FIXED 10px (`.pmc-box-key`), so size changes were invisible; now `font-size: inherit`. Shared `SizeControls` (A−/A+, number, SLIDER 8-60) in both editors; **All boxes** edbar toggle → one toolbar sizes EVERY text/fixed box on every page (canvas rings all boxes via `allSelected`; picking a box exits the mode). Doc "Needed" panel: **Custom text 1..N** rows (numbered over ALL custom boxes by page→y→x so labels stay stable; only empties listed; canvas never shows numbers).
- **Design hub** — status dropdown color-coded per state (sb-dh2-st-*); changes-requested note readable ON the row (revision milestone note OR the latest link's `change_notes` — now selected by listAllApprovalLinks) incl. pulse-extra rows; **Layouts approved** green tile (state 'approved' already existed, now surfaced); **All / New stone / Bronze / Inscription chips** (order service_types; drives layouts + estimates + library); **Layout library** third sub-tab — latest layout per order (is_current, job scope wins), search + type filtered, card click opens the existing viewer/uploader modal.
- **Back = where you came from** — `orderDetailReturn` context in Stonebooks: opens from Jobs/Design hub ("Design hub"), Permit Builder, Reconcile carry {label, tab}; OrdersTab → OrderDetail `backLabel` + onBack returns to the origin tab (Jobs subtab persists per-user, so Design hub + its dh2_scroll restore). All other openers clear the context.
- **Reconcile** — per-row **Delete** (close-candidates + needs-review buckets only; typed-DELETE window.prompt → hardDeleteOrder → "Wiped from Stonebooks"); **Layout catch-up** section + summary card: active bronze/new-stone orders with NO APPROVED layout artifact (one-query `listCurrentProofRefs` + `listJobOrderPairs` join), chips "No layout"/"Layout on file — not approved", per-row Upload (uploadProofLayout → createProofVersion → `approveCurrentProof` stamps approved_at → setOrderDesignStatus 'layout_approved' when a job exists) or Mark approved. NOTE: catch-up deliberately spans installed/paid_in_full too (records completeness), unlike designStateFor's active-only gate.
- **CALL chips honest (the Sandy row)** — derived `needsCall` pills REMOVED from OrdersTab rows + cards; CALL/EMAIL/custom chips render ONLY from a human-selected manual_blocker. The "Needs call" hot-chip FILTER + callReasons tooltips survive (triage stays, the false chip doesn't).

## Sprint FIELD-PAY-1 + PB-5 (2026-07-22) — SHIPPED: field payment entry, invoice zebra, permit upload/delete/foundation size

Commit 64629dd, Vercel Production success, prod template fixes applied + RETURNING-verified. Five Paul directives in one pass:

- **Field payment entry (his #1 ask):** `src/field/RecordPaymentSheet.jsx` — order picker (owing-first, search by name/number) → amount (Full-balance chip) / method chips / ref / date / note → RECORD. Entry points: Money screen top button (subtitle no longer "read-only") + OwnerOrderPanel "RECORD A PAYMENT" (order preselected; JobDetailScreen refetches the order via new `onOrderChanged` prop). Writes through the CANONICAL `recordOrderPayment` (the OrderDetail/PaymentsTab path — payments[] append + legacy deposit_*/balance_* mirror + reactive paid_in_full + updated_at concurrency guard + deposit-milestone sync). Check # required (desk parity). **Undo = voidOrderPayment** (money records append-only; the 8s undo leaves a VOIDED row, and `_paymentsColumnPatch` reverts paid_in_full on its own). Caller-side `logOrderActivity` + `pokePushSender` (owner payment push arrives near-instantly instead of on the next sweep). NOTE: a first draft added a duplicate `recordOrderPayment` to stonebooksData — the canonical one at ~2190 already existed; net stonebooksData change is ZERO.
- **Trade invoice table (Hall Monuments complaint — "lines striking through the line item"):** `downloadTradeInvoicePdf` drew each row divider only ~2mm above the NEXT row's baseline — 10pt capitals rise ~2.5mm, so every rule cut through the following row. Row rules REMOVED; now DESCRIPTION/AMOUNT header (repeats after page break) + every-other-row `setFillColor(237,237,237)` wash drawn UNDER the text (the exact contract-table zebra), heavier hairline before TOTAL. `buildTradeInvoiceEmail` rows match (no borders, #f2f2f2 alternate).
- **Permit audit (Paul: "multi-page permits show one page"):** compared every source PDF in his three Downloads zips (WinRT PdfDocument page counts) against prod `permit_templates.pages`. Verdict: **13 of the 15 "2-page" blanks have BLANK duplex scan backs** (~19KB renders, visually confirmed empty) — the PB-2 one-page conversions were correct; **only Hollywood Memorial genuinely lost its p2** ("Sketch of Memorial" + office-use block), and **Rosemount Memorial Park was never templated at all**. St. Gabriel's + Marlboro Bronze already carry storage-URL p2s (uploaded through the app). Fixes applied to prod via Management API: Hollywood p2 appended to BOTH rows (guarded `jsonb_array_length(pages)=1`), Rosemount template created (cemetery `5c0d44e5`, 6 eyeballed seed fields incl. the Monument Foundation `_ X _` inches pair on `base_w_in`/`base_t_in`). Assets deployed first (`public/permit-forms/{hollywood-permit/p2,rosemount/p1}.png`, live-probed 200). Still open: St. Gertrude's Catholic Cemeteries authorization BLANK (only a filled example exists — carried from PB-2).
- **Upload a permit + edit over it:** per-order **Upload** button on Permit Builder Home → one-off `permit_docs` row with its OWN pages in `data.pages` (template_id NULL) → doc editor types over it with extras/checks/dims; **+ Add page** appears for own-pages docs; export/print wrap pages+fields into a synthetic template shape (`exportTemplate()`). `rasterizePdfFile`: maxPages 4→12, `skipBlank` canvas scan (<0.2% ink on a multi-page render = duplex back, skipped), `out.truncatedFrom` when capped.
- **Delete with a safety message:** styled `PbtConfirm` modal (red confirm, .pbt-btn-danger) replaces window.confirm — Recent-permits row + NEW Delete in the doc editor header. `deletePermitDoc` now also removes the attached `permit-<docId>.pdf` (order_attachments row + storage, best-effort). Template **Delete = archive** (`archived:true` — permit_docs reference templates, so built permits keep working; re-upload brings a fresh one).
- **Foundation size inset:** autofill keys `foundation_size` (trade, "3-6 x 1-2") + `foundation_size_in` (plain inches) — base footprint W×D, **slant/no-base falls back to the die footprint**; in the palette dropdown for any template. Dimension-arrow toolbar gained a **Foundation** quick label (FDN …). Shevco Foundation Permit's `fsize` box REBOUND custom→foundation_size in prod (new docs autofill it).

## Sprint SEND-1 (2026-07-21) — SHIPPED: send-safety gate + invoice preview/download + Trade logo

Commit 179e7e6, live-verified. Incident: a worker one-click sent trade invoice TI-2026-001 unintentionally. **STANDING DOCTRINE (also in memory feedback-send-safety): every customer/dealer-facing send goes through a confirm gate showing the EXACT email (recipient + subject + rendered body) — no bare send buttons, ever.**

- `src/components/ConfirmSend.jsx` — reusable gate: sandboxed-iframe email preview, explicit "Send to <email>" gold button, viewOnly mode doubles as pure preview. Adopt it for ANY new customer-emailing feature.
- Trade invoices (VendorsTab): "Send invoice" → "Preview and send" (gated via buildTradeInvoiceEmail — extracted from setTradeInvoiceStatus so preview and sender share ONE composer); "Preview" on sent/paid; **"Download PDF" at ANY status** (downloadTradeInvoicePdf in vendorsData — ink-light letterhead, hairlines only).
- `src/components/TradeLogo.jsx` — steel-blue stacked-slab mark + STONEBOOKS TRADE wordmark (deliberately far from cream/gold), applied: /trade login gate, invite signup, staff-wandered card (App.jsx ×3), PartnerPortal header.
- Audit note: other sendShopEmail callers are inside deliberate compose modals (EmailTab/OrderDetail/CustomersTab/DesignPacket/QuoteHub) — acceptable; sweep them onto ConfirmSend opportunistically.
- OPEN: Paul said "create a stonebooks trade app as well" — logo shipped; asked whether he also wants /trade installable as its own phone/tablet PWA (manifest + icon like SB Field). Browser pane hung during visual check — verified via live-bundle grep instead.

## Sprint PB-3/PB-4 (2026-07-21) — SHIPPED: expert editor + full order rail

Commits d3cf600 (PB-3) + 09963ac (PB-4), both live-verified. Paul: "EXPERT LEVEL PDF editor... in the actual build a permit i need to be able to add those things too" + "right side all the order information... basically everything."

- **Field kinds** (template + doc): 'text' (autofill), **'fixed'** (template's own typed text — dblclick to edit right on the form, seeds every permit), **'check'** (click toggles, ✓ or X style via `mark`, template default via `on` / "Starts checked"). PDF draws checks as VECTORS (WinAnsi has no U+2713). effectiveBox/seedDocData carry kind/mark/on.
- **Canvas engine**: click-vs-drag detection (>4px = drag; clean click fires onClickNoDrag — how checks toggle); arrow-key nudge on selection (Shift = 10px), wrapper tabIndex=0.
- **Doc editor**: Print (bloburl → viewer tab), **"Needed for this permit"** amber panel (missingAutofill: order-bound fields resolved empty, MISSING_EXEMPT skips company/date/fixed; Fill writes every box bound to the key; MISSING_ORDER_WRITEBACK sends plot_section/block/lot/row/grave + grave_location back via setOrderPermit), exact size input (sizePct×1000), Duplicate.
- **Order-info rail (PB-4)**: DOC_EMBED now full `order:orders(*)`; getOrderContext(orderId, customerId) → order_attachments (file_url/filename/category) + order_emails by customer (direction/subject/sent_at). Rail = collapsible <details> sections: Customer / Deceased / Cemetery+grave / Stone (trade + inch dims — orders store die in width_inches/height_inches/thickness_inches/depth_inches COLUMNS, base in base_config jsonb) / **Layouts (thumbs, click = placeLayout insert)** / Attachments / Email traffic / Notes, then the status+fees cards (PermitMoneyRail now .pbt-rail-stack). Sources load eagerly.
- Audit trick that session: matching leftover stones = SQL over width_inches/height_inches + shape ilike + status not closed (die_config does NOT exist as a column).
- Paul's next-level wishlist offered, not yet built: undo (Ctrl+Z), canvas zoom, snap guides, duplicate template, permit status chips on Home.

## Sprint PB-2 (2026-07-21) — SHIPPED: 36 permit templates live from Paul's two zips

Commits 596353c/646ed33 (batch 1: 15 templates + dup-cemetery copies) + d3303b5 (batch 2: 12 more). **All mapped by eye from Paul's blanks + filled examples; geometry = fractions of page images in `public/permit-forms/<slug>/pN.png` (1700px wide, mostly 2200 tall; MapleGrove 2338, OLV 1314 half-sheet, HolyCross 1545x2000).** PDF→PNG conversion: Windows WinRT PdfDocument via PowerShell (scratchpad script pattern — MUST load StorageFile + InMemoryRandomAccessStream type accelerators in the SAME call). sb-api.ps1 needs `-Encoding UTF8` on Get-Content.

**Conventions learned from Paul's filled examples (now autofill keys in lib/permitBuilder.js):** trade notation for stone (45"→3-9 via _trade; die_size/base_size/die_shape/base_line), plain inches for bronze (die_w_in/die_t_in/etc.), deceased_grave ("Name - Block 4 Section C..."), monument_full, split W/T/H keys, customer street/city/state/zip splits, deceased_dod, company_fax/email, bronze_mfr = Coldspring MN, see_reverse, polish_level. Checkbox X's = tiny custom boxes pre-placed at the common option (drag for others).

**Templates by cemetery (title → binding):** CloverLeaf permit+bronze+; Shevco own form (null cemetery — charges box FDN/P&M/Total/Check); Mt.Leb permit + MtLeb/ForestLawn combined grid (dup-copied to Forest Lawn + New Mount Lebanon); Alpine + Hollywood memorialization (CMS family, layout_slot page:'back'; Hollywood blank had residual "Beth Levine" — whited out via System.Drawing); StGertrude sketch sheet; Beth Israel permit+foundation+bronze (dup-copied to bare 'Beth Israel' row); Hillside ScotchPlains; Resurrection Pisc + Holy Cross (Diocese of Metuchen generic, $100); StStephen/StMary ($25, dup-copied); SacredHeart Parlin (null cemetery, 3pg, only p1 mapped); ChristChurch monument + inscription ($75); Hazelwood; MapleGrove Hackensack (null); Maplewood Freehold (null); Marlboro/Mt.Sinai foundation+bronze; OLV/New Calvary booklet; StGabriels Marlboro (null); StJohnBaptist Clark ($2.43/sq-in handwritten + $75); StStanislaus Kostka ($2/sq-in + $50, caps 34x14x24 / 40x14x32).

**OPEN QUESTIONS for Paul:** (1) StGertrude needs the BLANK Catholic Cemeteries authorization page; (2) unbound cemeteries — SacredHeart, MapleGrove, Maplewood, StGabriels have no cemetery rows (add or point at existing?); (3) photo releases (CloverLeaf + Hollywood, PNGs already converted in scratchpad) — want as templates?; (4) positions are eyeballed ±1-2% — Paul fine-tunes by dragging in the template editor.

**NEXT = PB-3 (task #29): Print button (exportPermitPdf returnDoc → bloburl → window.open) + "Needed for this permit" missing-info checklist at doc create (empty autofill fields → quick inputs; plot_* write back to the order). Paul's words: "pull the info from the order then ask me for the info that you dont have."**

## Sprint PB-1 (2026-07-21) — SHIPPED: Permit Builder foundation (AWAITING Paul's form uploads)

Commit 4d7bfd3, deploy 5541309321, live chunk verified (PermitBuilderTab + all 6 UI markers). Paul: permits are "one of the most time consuming parts of the job... I need this to be amazing." NOT yet piloted by a human — Paul is the first click; expect an iteration round. **NEXT: Paul uploads blank + filled example permits per cemetery; use the filled examples to place/bind each template's field boxes.**

- **Data**: `permit_templates` (cemetery_id, pages[{url,w,h}], fields[{id,key,page,x,y,w,h,sizePct,align,bold}], layout_slot{page,x,y,w,h}) + `permit_docs` (order_id, template_id, data{values,extras,layout,dims}) — migration `20260721_permit_builder.sql` APPLIED to prod (staff_all RLS). **GEOMETRY CONTRACT: everything is FRACTIONS of the page image; sizePct = fraction of page WIDTH** — editor CSS %-units and jsPDF math resolve identically. Template assets under `orders-attachments-public/permit-templates/{id}/` (public bucket reused, no new storage config). Gotcha: sb-api.ps1 needs `Get-Content -Raw -Encoding UTF8` (ANSI read mangles em-dashes → API 500 on JSON parse).
- **lib/permitBuilder.js**: CRUD; pdf.js (CDN 3.11.174) rasterizes uploaded PDF blanks in-browser (~1700px/page); 25-source AUTOFILL_FIELDS registry (customer/deceased/plot_section|block|lot|row|grave/die+base sizes/dates/company block — resolvers are defensive, missing→''); seedDocData; effectiveBox (template field ⊕ instance override); exportPermitPdf (letter, page bg CONTAIN, boxes, layout image clipped to crop frame via saveGraphicsState/rect/clip/discardPath, dimension arrows w/ triangle heads + white-halo labels, blank BACK page mode with ink-light header).
- **components/permit/PermitCanvas.jsx**: the shared surface — box drag/SE-resize/dblclick-inline-edit, layout crop FRAME (image pans inside via ox/oy fractions OF THE FRAME, width=scale×frameW; MOVE chip + SE handle on the frame), dashed LAYOUT AREA slot (template mode), SVG dimension overlay (1000-unit viewBox × aspect) with draggable endpoints.
- **PermitBuilderTab.jsx**: HOME (order search — permitNeeded first, all searchable; template auto-match by cemetery_id, 0→create prompt, >1→pick; recent docs resume/delete) · TEMPLATE editor (page tabs, upload/remove pages, field palette + per-field toolbar, layout area toggle) · DOC editor (autofilled boxes + extras, Re-autofill, hide field, layout insert from proof_versions **layout_image_url/version_number** or upload, zoom slider + Fit + front/back toggle, dims with Die/Base quick labels) · **money rail on EXISTING rails**: setOrderPermit status patch w/ auto timestamps (mirrors OrderDetail's savePermit), fees via createPermitOutgoingPayment + orders.permit[] append + logOrderActivity.
- **Wiring**: NAV_PRIMARY 'permitbuilder' right after Jobs; PermitHub header "Permit Builder →" dispatches `sb-open-permit-builder` (shell useEffect listens — avoids a 3-level prop thread).
- Known deferreds: template field mapping is manual (no OCR); doc uses the CURRENT template (later template edits shift old docs' base geometry — instance overrides survive); no doc-level template re-pick; multi-page PDFs cap at 4 pages.

## Sprint FUN-1 (2026-07-21) — SHIPPED: task streak easter egg

Commit 2f01a64, deploy 5540537240, live-verified (3 posters 200 at /easter/*.webp + 27 entry-chunk markers). Paul's spec: 3 tasks in one sitting → funny captions; **5+ → one of his three Chelsea posters pops, random, different every time; NO assigner-aware variants** (he vetoed "assigning as").

- `src/lib/taskStreak.js` — per-DEVICE sitting counter (localStorage `sb_task_streak_v1`, 45-min idle reset). Task 3 always "Task Master engaged."; task 4 shuffled caption (9-line pool incl. Chelsea lines, no-repeat-until-dry, never back-to-back on reshuffle); 5+ always a poster (same rotation rules; prefetch fires at task 4). Emits `CustomEvent('sb-task-streak')`; fails silent everywhere — the egg must never break tasking. Hooked ONLY in addShopTask's success path (the choke point both apps share).
- `src/components/TaskStreakFun.jsx` — mounted ONCE at App root (renders null until an event; public routes never fire). Desktop: gold-rail toast bottom-right (crown SVG, serif italic caption, count subline). /field: dark #0F1419 capsule, Fraunces gold text + draining bar, parked at bottom 152px — ABOVE the undo capsule's 96px spot so undo is never covered. Photo: centered overlay, tap-anywhere dismiss + 8s auto, count line "N tasks this sitting."
- Posters live in `public/easter/streak-{queen,overlord,pilot}.webp` (~330-380KB each, extracted from the session transcript's pasted images — NOT in the JS bundle, fetched only when a popup fires).
- Verified: dev-server DOM checks of all 3 states on / and /field + 10-check headless node test (thresholds, rotation, idle reset, corrupt-storage safety) in the session scratchpad (streak-test.mjs).
- If Paul wants more later: bigger surprise at 25 was floated and NOT built.

## Sprint SCHED-1 (2026-07-20 night) — SHIPPED: install lists from the complete order list

Commit 1f3fa46, deploy id 5529038494 verified (live SchedulerTab chunk greps for the picker markers). Paul's rule, now doctrine for every scheduling surface: **the ready list is the default, but ANY order must be addable — gates inform (chips), they never wall.** He hit this as "miscommunication in installation and workflow… can't build install lists."

- **`routeStopForKind(job, kind)`** (stonebooksData, next to READY_WORK_ROUTES — third consumer of the milestone routing, keep in lockstep): any job + batch kind → `{ source_milestone_key, completion_milestone_key, ready, note }`. Keys are wired wherever the milestones exist so dispatch ticks still cascade on override adds; `note` = plain-words gate reason ('Not paid in full', 'Not at install stage yet', 'Already installed'…). Ad-hoc kinds → ready, no keys, no chip.
- **`addJobsToBatch(batchId, stops)`** (replaced the dead zero-caller `addJobToBatch`): append stops to an EXISTING batch — dupe-safe per batch, `stop_order` continues after max for trip kinds, falsy keys → NULL (Migration L CHECK).
- **`StopSearchPicker`** (components/scheduler/, shared): focus with empty query → the COMPLETE ready-for-kind list (destination-agnostic, cap 30); type → EVERY open job searchable by lastname/customer/order number/cemetery (prefix > contains > number > cemetery, cap 14). Chips: green READY / amber gate reason. Add hands back the full stop bundle incl. `gate_note`.
- **BatchBuilder**: picker mounted in the Stops section (hidden for ad-hoc kinds); override stops show the amber `gate_note` tag in the stop list; first pick with no destination adopts that job's cemetery so save isn't gated on a field the pick implies. TripSuggestionsPanel untouched.
- **Blocked-installs panel** (WeekWorkbench): no longer read-only — per-row **"Schedule anyway →"** seeds BatchBuilder with the row (it already carries the exact stop-bundle shape) + reason as gate_note, kind 'setting'.
- **Day dispatch sheet**: **"+ Add stop"** in the header (hidden for completed/cancelled/ad-hoc batches) → inline picker → addJobsToBatch → reload. `allJobs` threads SchedulerTab → CalendarDay → CalendarDayDispatch.
- Field InstallsScreen needs nothing — it reads the same batches.
- NOT done (deliberate): shop-block (blasting/acid-wash) add-stop parity; foundation_list-style named standing lists (batches with `scheduled_date NULL` in the tray are the current answer).

## Sprint FIELD-7 (2026-07-20 night) — SHIPPED: production floor, per-person tabs, native phone Settings

Commit 44f49d5 (+ 6d1c881: BOTH Sales views land on All — desktop OrdersTab + field SalesScreen, chip order All·Orders·Leads).

- **ProductionFloorScreen** — bucket lanes (To order / In shop / Blasted / Foundation / Everything; ProductionScreen's exact derivers) → tap a lane → stones with a per-row **STATUS** button opening StatusSheet with ZERO extra fetches (getJobs rows carry job+milestones+order). Refetches once when a dirty sheet closes. Default tab for Production/Installation departments.
- **Per-person bottom tabs** — `employees.field_tabs` (migration `20260720_field_tabs.sql` ✅ APPLIED) + `src/field/fieldTabs.js` (TAB_REGISTRY today/tasks/production(FLOOR)/jobs/sales(ownerOnly)/find/more; resolveTabs sanitizes: Today first + More last locked, middle ≤4, role-gated, garbage falls back to role defaults). Edited in the phone Settings; saves live-refresh the bar (loadEmployees → setWho). Overflow tabs render as MORE's first tiles ("Not in your bar").
- **FieldSettingsScreen** (first MORE tile, both builds): identity + switch person, copy MY field link, notification prefs, the tab editor, sign out. **MoreScreen is crew-capable**: overflow + Settings + Catalog for all; money suite (incl. New-lead intake) + desktop deep links owner-only.

## PUSH + LINKS ACTIVATED (2026-07-20 night) — and the day's open threads

- Paul set the 4 Vercel env vars (3 VAPID from Desktop/stonebooks-vapid-keys.txt + `FIELD_LOGIN_EMAIL=pauly_vargas@outlook.com`). Verified live: `/api/push/send?config=1` → 200; `/api/field/redeem` → invalid_key for bogus probes (armed). The sender has a whole-handler JSON crash guard + env cleaning (first configured run FUNCTION_INVOCATION_FAILED opaque — never again).
- **Session persistence is ROUTE-SCOPED** (`src/lib/supabase.js`): /field + /sales persist (links depend on it); desktop + /trade are in-memory per visit — Paul's explicit call. autoRefreshToken on everywhere.
- **Push subscriptions re-key by ENDPOINT to whoever the phone is picked as** (syncPushOnLaunch) — a phone that switches person moves its subscription. First sub landed as Collin (digest+payment muted via prefs — the prefs system works).
- **OPEN: employees.is_owner is TRUE for 7 people** (Paul, Alex, Catherina, Chelsea, Denise, Lonnie, Sabina — flipped the night of 2026-07-20). Owner = money/proof pushes + bell rows + owner phone build. Paul was asked whether intentional — UNRESOLVED. If not intended: uncheck in Settings → Staff + sweep crew `payment` rows from notifications.
- **OPEN: the Vercel cron died ~Jul 14** (email inbox froze; team is on PRO so not plan limits — root cause unknown; check the dashboard Cron Jobs page / project settings). Meanwhile: EmailTab self-syncs every 90s while open; pokePushSender covers task/reply pushes; the 7am digest depends on SOMETHING invoking the sender after 7am — if crons stay dead, digests only fire on the first poke after 7.
- **Email sync is newest-first with a gap lane** (`${mailbox}:gap_high/:gap_low` cursors in email_sync_state): outage holes import the newest batch first, middle drains downward. Sent Mail fixed: outbound rows carry received_at (backfilled 10,477; both writers stamp it), STEP_TIMEOUT 30s, mailbox order alternates by minute parity.
- **Estimate sheets**: layout image renders aspect-true even under the one-page squeeze (width pre-scaled by S — the wrapper multiplies heights only). No solid black bars on any PDF (ink rule, see memory feedback_pdf_style).
- **Garcia one-click**: his estimate layout predates the auto-stamp — flip his Design status dropdown to "Layout created" once by hand.

## Sprint FIELD-6 (2026-07-20) — SHIPPED: private field links, flat crew bar, push preferences

Commit 9e6da17. Three Paul directives in one slice:

- **Sessions persist app-wide** (`src/lib/supabase.js` persistSession:true + autoRefreshToken — the "log in every time" annoyance is dead everywhere, desktop included). On top, **PRIVATE FIELD LINKS**: `employees.field_key` (migration `20260720_field_keys.sql` ✅ APPLIED, unique partial index) + **`/api/field/redeem`** (POST {key} → validates against active employees → mints a REAL persisted Supabase session for the shared staff account via `admin.generateLink({type:'magiclink'})` + client `verifyOtp` — no email round-trip; flat 401 on unknown/short keys, no enumeration; **requires env `FIELD_LOGIN_EMAIL`** = the shared staff account's email) + **`src/field/fieldLink.js`** (`redeemFieldLinkIfPresent` runs before the auth gate on every /field boot: reads `#k=`, strips it from the URL/history immediately, stores the key on-device (`sb_field_key`) so an expired session self-heals, drops the stored key on 401 so revoked links stop retrying; `makeFieldKey` = 24 bytes crypto randomness base62). The link pins the phone's person (`setFieldWho`) — WhoPicker skipped. **Settings → Staff:** per-person Create field link / Copy field link / New link (two-tap regenerate = revoke; `updateEmployee` whitelists `fieldKey`, min 20 chars). Links are credentials — same trust model as approval share links; staff-visible in the roster (acceptable, staff-internal).
- **Flat crew bar** ("the production worker tabs are terrible, only the owner tab is good"): raised camera bump REMOVED; crew = Today / Tasks / Jobs / Find, owner keeps his six — both in the flat grammar with the gold-underline active state (`.fl-nav` overrides in fieldUndo.js). The crew camera is a big dark PHOTO button beside "+ New task" on Today (`.fl-cam-btn`, same capture→attach CaptureSheet flow; `onCapture` prop, owner passes null).
- **Push preferences:** `NotifPrefsSheet` (header menu → "Notification settings", shown when push is on) — per-DEVICE toggles by kind stored in `push_subscriptions.prefs` jsonb (absent = on): crew task_assigned / task_reply / digest; owner adds payment / proofs. Optimistic flip, reverts on failure. **The sender enforces them** (`deviceMuted` in api/push/send.js — pref key from the dedupe-key prefix; changes+signed share 'proofs'). Feed rows are never filtered — the bell keeps everything.
- **TO ACTIVATE (Paul, one Vercel visit):** VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (Desktop/stonebooks-vapid-keys.txt) **+ FIELD_LOGIN_EMAIL** (the staff sign-in email) → redeploy. Until FIELD_LOGIN_EMAIL is set, /api/field/redeem returns field_login_not_configured and links fall back to the normal sign-in screen (which now persists, so it's one-time anyway).

## Sprint FIELD-5 (2026-07-20) — SHIPPED: customer self-service intake + pocket catalog

Two MORE-hub tiles (commit bec5b7d), same-day follow-on to FIELD-4:

- **NEW LEAD (`src/field/IntakeScreen.jsx`)** — "hand the phone/iPad to the customer." Full-screen kiosk overlay (z-90 over the whole shell; a guest is holding the device — no money, no CRM surfaces reachable). Steps: Welcome → About you (first/last/phone required, 10-digit check; email + collapsed mailing address optional) → Cemetery (searchCemeteries typeahead; typed-new names allowed — saveOrder lookup-or-creates; skippable) → Service (single-pick cards, NewLeadModal's orders.service_types codes + "Not sure") → Who it honors (up to 3 people: names, DOB/DOD date inputs, per-person pre-need checkbox hides date-of-passing, relationship; last name placeholder-defaults to the contact's) → Review + "Anything else" free text → Submit → Thank-you. **Writes the EXACT desktop lead path** (makeBlankOrder + saveOrder, status 'draft', deceased mapped onto makeBlankDeceased) so it surfaces in Leads/Sales like any first-call lead. `salesRep` = the phone's picked person (feeds the "Created by" filter). An order note records "Self-service intake — customer entered their own details" + their free text. **Staff gates:** the discreet STAFF chip (exit mid-entry) and the thank-you screen's "Staff: finish" both require the picker PIN when the person has one, a deliberate two-tap when not. Finish → onOpenLead lands staff on the fresh record. Submit failure keeps every answer (retry-able).
- **CATALOG (`src/field/CatalogScreen.jsx`)** — read-only monuments browse: shared `fetchMonuments` cache with the sales wizard (exported via SalesMode's bulk export list — do NOT add an inline `export`, it duplicate-export crashes the parse), filters `!is_archived`, search over lastname/name/tags/cats + cleaned id codes (cleanCatalogId replica: "local_A0001.jpg_…" → "A1"), shape chips = DESIGN_CATEGORIES codes verbatim (slant / double-slant / upright-single / upright-double / flat / custom-shape), lazy 2-up image grid (40 + Show more), tap → fl-sheet detail (full image, shape/color chips, tags).
- MORE's native grid now leads with New lead + Catalog (`.fl-cat-*` CSS in fieldUndo.js).
- Verified: build green (0 errors), /field console-clean on the dev server; on-phone tap-through is Paul's (auth wall).

## Sprint FIELD-4 (2026-07-20) — SHIPPED: the two 2026-07-18 push builds unified + owner suite

**The fork, for the record:** Friday's local session built FIELD-3 (owner suite + PINs + bell feed + its own push pipeline), applied its migration to prod, staged everything — and died before committing (OneDrive git casualty). Saturday's cloud session, not seeing that work, built FIELD-PUSH (a different push pipeline) + four owner-nav directives from Paul, and deployed. Monday reconciled: **cloud base wins** (it embodies Paul's latest IA — owner bar Today / Tasks / Jobs / Sales / Find / More, crew keeps the raised camera), FIELD-3's product surface grafted on top. The un-merged FIELD-3 commit is parked on branch `field-3-local-archive` (c2eea69) — do not delete; it's the provenance of the grafts.

- **DB (migration `20260720_field_push_unify.sql` ✅ APPLIED + verified):** `push_subscriptions` reshaped to the deployed code's shape — person_name / keys jsonb / user_agent (was the FIELD-3 employee_name/p256dh/auth shape, table was empty) + `push_send_log` (dedupe_key unique — the claim-before-send idempotency ledger, rows pruned after 14d). KEPT from the FIELD-3 migration: `notifications` (the bell feed), `employees.pin`, `push_state` (unused by the stateless sender; retained). **Do NOT apply `20260718_field_push.sql`** — superseded by the unify migration.
- **Sender (`api/push/send.js`)** = FIELD-PUSH mechanics (stateless 36h sweep, claim-before-send via push_send_log ignore-duplicates upsert, per-person cap 8/run newest-first, 7am ET due-today digest once/day, 404/410 endpoint prune, `?config=1` public-key fetch, sw-initiated `resubscribe` re-key, CRON_SECRET-or-staff-JWT auth, pokePushSender instant delivery) + FIELD-3 owner sources: **proof_changes / proof_signed (approval_links) and payment (orders.payments[] locked non-voided), owner names only — enforced in the sender, audience = employees.is_owner.** Every claimed event EXCEPT the digest also inserts a `notifications` feed row — **for the full audience, not just subscribed phones** (the bell works without push permission; the ledger claim gates feed rows AND sends, so overlapping sweeps never double-write). Push payload badgeCount stays = due-today+overdue (Tasks-badge parity); the bell has its own unread count.
- **Bell:** header bell + unread badge in the /field shell (both builds); `NotificationsScreen` (Today/Yesterday/day groups, optimistic mark-read, undoable mark-all, banner→PermissionSheet when push is off). Feed helpers in `src/lib/notificationsFeed.js`. Deep links use the SAME URLs as push payloads (`/field?task={id}` / `/field?order={orderId}`); the shell handles both on cold start and via the sw `sb-field-open` message.
- **The ask:** `PermissionSheet` (mock push preview, role-tuned bullets, synchronous `Notification.requestPermission()` inside the tap — iOS drops it otherwise — then `fieldPush.subscribeThisPhone`; deny → iOS Settings walk; "Not now" → 7-day snooze `sb_field_push_snooze`). Entry points: Today's dark push card (its own forever-dismiss `sb_field_push_dismissed`), header-menu Notifications row, bell banner. No auto-open — the card is the invitation.
- **PINs:** `employees.pin` (4-digit, optional) gates the WhoPicker per person (deterrent, not crypto — closes "worker taps Paul" until per-person passwords). Set/cleared inline in Settings → Staff (`updateEmployee` validates 4 digits). Picker rows show "· PIN".
- **Owner suite on Saturday's IA:** SALES rows (all three views) carry a **STATUS** button → `StatusSheet` (Design / Stone-Bronze / Foundation / Blocker chips; the desktop master-override helpers — vocabulary-aware, optimistic, 8s undo; row becomes div-with-button-semantics since HTML forbids nested buttons). Owner JobDetail mounts **`OwnerOrderPanel`** (contact CALL/TEXT/EMAIL — customer phone columns are phone_primary/phone_alt, no bare `phone`; balance + read-only locked-payment list, voided struck; approval links with customer change_notes + copy-link; task check-off with undo; activity trail). **MORE hub = two layers:** "On this phone" native tile grid (Money / Schedule / Approvals / Customers / Leads / Permits / Vendors / Cemetery orders — phone-fit, read-mostly; Schedule has BUMP +1 DAY via updateBatch + undo) above the "Full desktop" `/?tab=` deep-link rows.
- **TO ACTIVATE push (Paul, one-time):** (1) VAPID keys were already generated Friday — `Desktop/stonebooks-vapid-keys.txt` (3 lines: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT). Add all three in Vercel → the stonebooks project → Settings → Environment Variables (Production) and redeploy. **Never rotate after phones subscribe.** (2) Each phone: install to Home Screen (iOS 16.4+), open /field → Today card → Turn on. Until then the sender returns `push_not_configured` and the bell still works. Probe: `GET /api/push/send?config=1` → 200 publicKey when env is set.
- **Verification trail:** migration applied via Management API + schema verified; `npm run build` green (lint + vite); /field loads console-clean on the dev server (auth wall limits deeper automated taps — first on-phone pass is Paul's).

## Sprint FIELD-PUSH (2026-07-18) — BUILT, needs activation — SUPERSEDED by FIELD-4 above (its migration was never applied; do not apply it now)

The FIELD-2 "next slice": Web Push for the phone app — a new task or reply lands on the assignee's phone in seconds, plus a 7am due-today digest. Tasks/replies only in v1 (the richer notification rulebook from the redesign session extends on top of this substrate later).

- **Migration `20260718_field_push.sql` — ⚠ NOT YET APPLIED to prod:** `push_subscriptions` (person_name + endpoint unique + keys jsonb; the phone subscribes AS A PERSON — shared staff sign-in means the fieldIdentity name is what routes) + `push_send_log` (dedupe_key unique — the idempotency ledger, rows pruned after 14d). Three-role RLS parity on both.
- **Sender `api/push/send.js`** (Vercel fn, cron `*/5 * * * *` in vercel.json + fire-and-forget pokes): stateless sweep over a 36h window — task-assigned (person or department fan-out via employees, actor never self-pinged), task-reply (pings both sides minus the author; skips already-handled), due-today digest (after 7am ET, once/day/person). **Claim-before-send:** each (event, person) is claimed in push_send_log via ignore-duplicates upsert — only rows actually inserted get sent, so overlapping cron ticks + pokes can never double-notify. Per-person cap 8/run (newest first — first-deploy backlog becomes a few fresh pings, capped-out events stay claimed = dropped). Every payload carries `badgeCount` (that person's due-today+overdue count, same rule as the app's Tasks badge) for the home-screen badge. 404/410 endpoints auto-pruned. Auth mirrors email/sync: CRON_SECRET bearer or staff JWT; `?config=1` returns the VAPID public key (public by definition); unauthenticated `resubscribe` action re-keys a rotated subscription by old endpoint only (sw.js pushsubscriptionchange — the unguessable old endpoint is the credential, can never create rows). Sweep logic verified against a mock PostgREST harness pre-commit (audience, self-exclusion, dept fan-out, reply routing, digest counts, claim-skip all asserted).
- **`public/sw.js`** — push-only service worker, deliberately NO fetch handler (zero cache-staleness risk to either app). showNotification + app-badge set; notificationclick focuses an existing /field window and postMessages `{type:'sb-field-open', url}` (no reload) or opens one.
- **Client (`src/field/fieldPush.js`):** capability detect (iOS Safari not-installed → 'needs-install'), enable (register SW → permission → subscribe with VAPID key fetched from ?config=1 → upsert row), disable, `syncPushOnLaunch` (clears app badge; when granted, re-upserts the row — re-keys person_name when the phone switches person). **UI:** Today-screen enable card (both builds, dark, dismissible via localStorage `sb_field_push_dismissed`; needs-install variant shows Add-to-Home-Screen steps) + header-menu Notifications row (on/off toggle, blocked/needs-install notes). Deep links: `/field?task={id}` on cold start + SW message while open both land on the task (FieldApp effects).
- **Instant delivery:** `pokePushSender()` (`src/lib/pushPoke.js`, 2.5s burst-collapse, always-silent) fired from `addShopTask` + `addTaskReply` in stonebooksData — the shared chokepoints, so desktop task/reply writes ping phones too. Cron is the backstop.
- **TO ACTIVATE (Paul):** (1) run `supabase/migrations/20260718_field_push.sql` in Studio (or Management API); (2) `node scripts/generate_vapid_keys.mjs` once, set the printed `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` on the Vercel project and redeploy — **never rotate them after phones subscribe** (rotation silently kills every subscription); (3) each phone: install to Home Screen (iOS 16.4+ required for push), open the app → Today → "Turn on". Until (1)+(2), the card's Turn on reports "Push is not configured on the server yet." and the cron returns push_not_configured — everything else is inert.
- **Owner nav follow-ups (same day, four Paul directives, iterated live):** (1) Work hub back → JOBS tab; (2) one-tap Orders back; (3) raised (+) center button REMOVED ("in the tasks I should be able to add new task" — the Tasks screen's "+ New task" + Today's My-tasks card are the entry points); (4) "access ALL of Stonebooks on my phone" + "make it a SALES tab with orders/sales/all like in Stonebooks". **Final owner bar: Today / Tasks / Jobs / Sales / Find / More — six plain slots, no center CTA.** `SalesScreen` mirrors the desktop Sales tab's views exactly (Orders | Leads | All; `OrdersScreen` gained a `view` prop — isOrderRow+rowTotalPaid parity, 'all' widens the fetch to closed/cancelled/archived with status chips; `view=null` = legacy behavior for FIND). `MoreScreen` lists every remaining desktop section (Customers→Settings, 14 rows) and opens each as a **`/?tab=` desktop deep link in a new browser context** — `Stonebooks.jsx` tab state now boots from a validated `?tab=` param (additive; sandbox note: `/` renders the catalog unless `VITE_APP_MODE=stonebooks`, set in prod). Opened tabs require the staff sign-in (persistSession is false app-wide — the per-person-passwords slice will absorb this). FindScreen `mode 'orders'` unmounted again. Crew bar unchanged: Today / Tasks / [raised camera] / Jobs / Find. Native phone versions of the More sections = future slices as they earn priority.
- **Remaining from the FIELD-2 next-slice spec:** per-person passwords via invite links (auth-model change — every phone still shares the staff sign-in today) + the full notification rulebook/IA beyond tasks (needs-you events, run assignments) in session memory `project_shevco_field_redesign`.

## Sprint FIELD-2 (2026-07-18) — SHIPPED

Role-aware rebuild of the /field phone PWA to the approved "Stonebooks Field" prototype (design artifact + full specs generated in the 2026-07-18 ultracode session; multi-agent build + adversarially-reviewed, 16 findings fixed pre-commit).

- **Identity + roles:** migration `20260718_field_owner_flag.sql` ✅ APPLIED (employees.is_owner, Paul=true). After the shared staff sign-in, each phone picks its person once (WhoPicker → `sb_active_staff`, the desktop's identity key — every actor stamp app-wide now names the real person). `src/field/fieldIdentity.js` resolves `{name, department, isOwner}`; stale/deactivated names force a re-pick. Settings → Staff gained an "Owner app" checkbox (updateEmployee isOwner patch key).
- **New shell (FieldApp.jsx):** tabs — crew: Today / Tasks / Jobs / Find; owner: Today / Tasks / Orders / Find; raised gold center action (crew = camera capture → CaptureSheet attach-to-task; owner = NewTaskSheet). Tasks tab carries a red due-badge (mine, due today/overdue, snooze-aware). Tab screens stay mounted (hidden) during a job drill so internal state survives. Old Installs/Production/Orders/Inventory screens all survive under the new chrome.
- **New screens:** `TodayScreen` (crew: greeting, today's run card with featured next stop + Directions/Open stop + progress, my tasks with check-off; owner: Needs-you lane (proof edits → stale approvals ≥3d → overdue tasks, cap 5, "Nothing needs you." empty), today's runs with live stop dots, This-month money card (collected = separate all-orders payments query, MONEY_PULSE semantics; balance due = paged open-orders fetch), my tasks) · `TasksScreen` (Mine/Everyone/Done, task detail with reply thread + photo attach, check-job checklist card) · `WorkHubScreen` (queue tiles: Installations/Foundations/Check jobs/Production with counts) · `FoundationsScreen` (dig list grouped by cemetery, 4-stage indicator) · `FindScreen` (search + inventory; owner Orders tab) · `fieldSheets.jsx` (NewTaskSheet, CaptureSheet; onChanged bumps the shell's taskRev to refresh screens + badge).
- **MONEY DOCTRINE:** crew builds render no dollar amounts — OrdersScreen + JobDetailScreen take `showMoney` (owner-only); LEAD banner keeps the warning, drops the figure for crew. (v1 is render-layer gating; query/RLS-layer exclusion is the flagged follow-up.)
- **Fixed in passing:** JobDetailScreen's sync `getCurrentStaffName()` call (stamped a Promise) → `getActiveStaffUser()`; legacy `.fl-btn-gold/.fl-btn-ghost` modifier collision scoped; `.fl-toast` now layers above sheets (z-70).
- **NEXT SLICE (specced, not built):** Web Push notifications — sw.js + VAPID + push_subscriptions + Vercel cron sender; per-person passwords via invite links (today all phones share the staff sign-in, then pick person). Full notification copy rulebook + IA in the session memory `project_shevco_field_redesign`.

## Sprint SALES-OPTIONS (2026-07-06) — SHIPPED

Directive build: settings-managed sales options + gray overhaul + cemetery cleanup + header fix.

- **`sales_options` table** (migration `20260706_sales_options.sql`, ✅ APPLIED to prod via Management API) — owner-editable option lists per category (`stone_color` first). `value` = the existing `orders.granite_color` code for pre-existing colors; `premium` is a FRACTION (0.25 = +25%), same numeric the engine multiplies. 22 colors seeded (new: Light/Medium/Dark Gray + Imperial Pink, premium 0; existing colors carried their premiums; 'Barre Grey' label normalized → 'Barre Gray'). Soft-delete only (`is_active`). Public `sales-options` storage bucket for swatch uploads. RLS: staff-all + partner/anon lockdown parity.
- **`src/lib/salesOptions.js`** — fetch/cache + `applyStoneColorsToCatalog()` merges rows INTO the shared `GRANITE_COLORS` table in place at boot (same pattern as `applyPricingConfig`), so the sync pricing engine and every render path keep working. Deactivated/legacy colors stay in the catalog for saved-order lookups; pickers list actives via `getActiveStoneColors()`. Load order: `loadPricingConfig().then(loadSalesOptions)`; `savePricingConfig`/`loadPricingConfig` call `reapplyStoneColors()` because config-apply resets premiums.
- **Settings → Sales Options tab** (`src/components/SalesOptionsSettings.jsx`, owner-gated) — drag-to-reorder, inline label/premium (% displayed, fraction stored), Add Color w/ optional swatch upload, Deactivate/Reactivate (inactive collapsed section). **Color premiums group REMOVED from PricingSettings** (legacy `colorPremiums` config still applies but sales_options overlays it last — sales_options is the premium source of truth).
- **Part 1E order safety — color premium snapshot-at-save.** `orderToRow` writes `pricing.colorPremiumSnapshot {code, premium, label}` whenever graniteColor is set (re-snaps only when the color CHANGES). `effectiveColorPremium(order)` (monumentCatalog) prefers the snapshot; `buildLineItems` color-premium/base-color-premium + the orderRates custom-die recompute all use it. Legacy orders w/o snapshot fall back to the live catalog (unchanged behavior) and get snapped on next save.
- **Origin scrub (Part 2).** `getGraniteOrigin` display label DELETED — 'Domestic'/'Imported'/'Vermont' never print anywhere customer-facing (picker card, contract/estimate PDF kvRow, saved-view summary all show label only). Due-date buffer logic kept as internal `isFastSupplierGranite` (`DOMESTIC_GRANITE_CODES` = medium-barre-grey, mountain-rose). New `displayColorLabel(raw)` in monumentCatalog scrubs legacy text ('Vermont Gray'→'Barre Gray'; strip Domestic/Imported; strip standalone Vermont) and is routed through `displayGraniteColor`, so ALL render paths (PDFs, OrderDetail, receipts, quote hub, PR prints, specs) inherit it. Stored order data untouched.
- **Picker UX (Part 2C).** ColorStep gained an "All colors" dropdown ABOVE the swatch grid (imageless colors like the new grays are selectable there); grid shows only colors with a swatch (uploaded `image_url` wins over bundled `/granite/` asset via `colorSwatchUrl`). BLING/vase color grids + both OrderForm selects read actives too.
- **Hearts (Part 3).** `heart` ('Single Heart') + `double-heart` ('Double Heart') added to SHAPES (no standardSizes → custom L×H×$4.55 die pricing path, canHaveBase) + MONUMENT_TYPES; included in the polish/sides gate, NOT the top-shape gate; single die component each.
- **Cemetery cleanup (Part 4, AUDIT-FIRST).** Migration `20260706_cemetery_casing_cleanup.sql` ✅ APPLIED: `title_case_cemetery()` Title Case pass over `cemeteries.name` + `cemetery_orders.cemetery_name` (24 fixed, logged in `_cemetery_casing_log`). `merge_cemetery(from_name,to_name)` + `merge_cemetery_by_id(from,to)` DEFINED BUT NOT RUN — Paul approves per pair. **Duplicate report: `supabase/reports/2026-07-06_cemetery_duplicate_report.md`** (exact dupes: Hillside ×3, Fairview ×2 (rename don't merge), St. Gertrude ×2, St. Mary's ×2; plus variant/junk sections). NO MERGES PERFORMED.
- **Header (Part 5).** WorkspaceStrip recent-items chip row removed entirely (`WorkspaceStrip.jsx` + `useWorkpieces.js` deleted; workpiece registry pruned from `workspaceState.js` — recents/role/hub/jobsView persistence kept, they have other consumers).
- **Deferred (Part 6A):** Permits Hub payment section (Cemetery|Name|Job|Amount|Method|Date) — TODO comment in PermitHub.jsx; waiting on Paul: permit-log import vs new staff-editable table.
- **Note:** prod SQL ran via the Supabase Management API using the CLI token from Windows Credential Manager (helper script pattern; token never printed). Studio remains the fallback.
- **Part 4 EXECUTED (same day, per Paul's decisions + addendum):** 24 merges + 4 guarded deletes run in prod — cemeteries 109 → 83, 0 orphans, all audited in `_cemetery_merge_log` (with notes: GERD=St. Gertrude, Ukr→St. Vladimir's, Alpine Mausoleum folded into Alpine Cemetery w/ detail preserved on the order, Mt. Calvary → 'Mount Calvary Cemetery — Linden'). Fairview split-renamed (Westfield / Staten Island). Specific rows created: Hillside — Linden (fixed demo row) / Scotch Plains / Lyndhurst. **Final report: `supabase/reports/2026-07-06_cemetery_cleanup_final.md`** — round 2 same day: Resurrection merged into '— Piscataway' (Paul confirmed), St. Peters renamed St. Peter's Episcopal Cemetery (distinct from St. Peter & Paul), 13 test orders + 9 jobs + 12 test customers purged (full-row snapshots in `_test_data_purge_log`), E + Christ Cemetery rows removed. **CLEANUP CLOSED per Paul: generic Hillside rows/orders and E-26-0354 (Hillside/New Mt. Zion) stay AS-IS deliberately — do not re-flag.**

## Sprint FIELD-MODE (2026-07-13) — SHIPPED

Phone-first crew app at **/field** (`src/field/`, own route in App.jsx's dispatch ladder before the APP_MODE fallbacks). Shares ONLY the Supabase client + stonebooksData helpers with the desktop; **no desktop component touched or restyled** (Paul's hard constraint). Design approved via interactive mockup artifact first.

- **Screens:** Installs (14-day scheduler batches → getBatch(id) deep re-fetch per batch, same as SchedulerTab; FDN chip incl. Drop Off; LEAD pill; Apple-Maps Directions) · Production (stone-ladder filter chips, same derivers as desktop) · Orders (search, balance, LEAD) · Job detail (approved layout IMAGE only — proof first, `designs[0].snapshot.img` fallback — tap-to-zoom; die/base/granite cut sheet; stone + FDN ladders as tap targets; **every status write offers an 8s UNDO** via `useUndoToast`; "Mark exact spot" = GPS + note + photo → `orders.field_location` jsonb, photo also into order attachments) · Finish (camera-first completion photos via uploadCompletionPhoto; Mark installed gated on ≥1 photo, resolves installed/door_installed/work_completed, override reason 'Completed in the field', undoable) · **Inventory (rides the EXISTING `inventory_stock` table + helpers — one source of truth with the desktop InventoryTab; add / receive-adjust with stepper + explicit confirm + undo)**.
- **PWA:** `public/manifest.webmanifest` + `sb-field-icon-180/512.png` (System.Drawing-generated SB monogram) + apple-touch meta in index.html (additive only). Add to Home Screen installs full-screen with the SB logo.
- **Settings → Field app** (`src/components/FieldAppSettings.jsx`): copy the /field link + send setup email (sign-in pointer + Safari Add-to-Home-Screen steps) via `sendOrderEmail({orderId:null})`.
- **Migration `20260713_field_mode.sql` ✅ APPLIED to prod via Management API:** `orders.field_location` jsonb + `inventory_items`/`inventory_events` (spare event-ledger tables with full RLS parity — **currently unused**; field inventory uses `inventory_stock`. Paul declined the drop; decide keep-vs-drop later).
- Same-day commits also shipped: sales_options pre-auth wipe fix (colors picker), FDN **Drop Off** rung (rides `foundation_scheduled`, no migration), **LEAD — NO DEPOSIT** loud treatment (OrderDetail banner+pill, OrdersTab rows/cards, wizard saved-step flag; keys on locked non-voided payments only), wizard general **Attachments** section (saved step, same bucket/path as OrderDetail).

## Sprint FOUNDATIONS-LIST (2026-07-14) — SHIPPED

Jobs › **Foundations** tab — the hand-picked foundation work queue (the ~15 we're actually digging/pouring, out of the ~300 that need one). New file `src/FoundationsBoard.jsx`; tab wired in `JobsTab.jsx` (JOBS_TABS + body branch between Installation and Permits); data helpers in `stonebooksData.js` after `isReadyToSet`.

- **Migration `20260714_foundation_list.sql` ✅ APPLIED to prod via Management API:** `foundation_list` table (`job_id` unique FK → jobs, cascade; `added_by`, `sort_order`) + three-role RLS parity (authenticated-all, restrictive `is_staff()`, anon false). Membership only — **status stays milestone-derived** (`deriveFdnStatus`/`setOrderFdnStatus`), so the Installation gates, field app, and this board all read the same truth; "Ready" here IS `foundation_in`.
- **Board (dark `.fdncc-*`, jobcc palette):** KPI cards (To dig / Dug / Poured / Ready, list-scoped) → picker panel ("Needs a foundation" pool = FDN ladder open + not `Cemetery Foundation`; search + cemetery filter, first-60 cap with narrow hint) → the list **grouped by cemetery** (one block = one dig run). Row: family (opens JobDetail), section (`composeGraveLocation`), base size (`buildBaseSpec(rowToOrder(...))`), Strip/need-map/drop-off side tags, **4-stage tap stepper** (Not started → Dug → Poured → Ready; need_map/drop_off read as stage 0 with a warn tag), Pin spot, Remove.
- **Status taps are optimistic:** `orderStatusWritePlan('fdn', code)` mirrored locally (`applyFdnPlanLocally`) instead of refetching 1000 jobs per tap.
- **GPS pins ride `orders.field_location`** (same jsonb as the field app's Mark exact spot) — `PinSpotForm` = GPS + note, preserves an existing pin photo; "Open pin" → maps.apple.com daddr link. Desktop-browser GPS denial degrades to note-only with a "drop the pin from your phone" hint.
- `addToFoundationList` treats a 23505 unique violation as success (double-tap safe).
- **Deferred:** /field Foundations screen (same list, phone-first) — Paul said desktop tab first, fast-follow if wanted. Foundation-cure gating (7-day window) remains parked under Phase 4 backlog.

## Fix: Design status dropdown on non-new_stone jobs (2026-07-14)

The Design dropdown (OrdersTab / OrderDetail / DesignHub) silently no-op'd on **bronze** and half-worked on **inscription** jobs: `deriveDesignStatus`/`_designPlan` were hardcoded to the new_stone `proof_*` trio, but templates carry different keys — bronze: `bronze_layout_created / bronze_proof_sent / bronze_proof_approved`; inscription: `layout_created / proof_sent / proof_approved` (no created/changes keys); cleaning_repair + mausoleum_door: **no design milestones at all**. Milestone UPDATEs `.in()` matched zero rows → ok:true, nothing changed.

- **`DESIGN_VOCABS`** in stonebooksData.js — vocabulary detected from the keys ON the job (not job_type). Derive + `_designPlan(code, vocab)` + `orderStatusWritePlan('design', code, job)` (new third arg; OrdersTab passes `o._job` for the optimistic mirror) are all vocabulary-aware.
- **`setOrderDesignStatus` is key-fetch-first** and **seeds the standard proof_* trio** (group/team `design`, canonical labels/sort) when a job has no design vocabulary — returns `{ ok, seeded }`; `seeded` tells optimistic callers (OrdersTab) to `reload()`. 23505 on seed = concurrent seeder, proceed.
- Vocabs without a changes key map `needs_adjustments` → created+sent done (derived status then reads `layout_created` — known snap-back, accepted).
- **Same latent bug exists for the STONE dropdown on bronze jobs** (`stone_*` plan vs `bronze_ordered`/`bronze_received`) — NOT fixed in this pass (one thing at a time); flag for a follow-up.

## Sprint ORDER-CONTROL (2026-07-14) — SHIPPED

Four Paul directives in one pass (separate commits): status master-overrides on every job type, red not-started tones, manual blockers, editable job type.

- **Stone / Bronze master override** — bronze jobs' Stone dropdown was a silent no-op (`bronze_ordered`/`bronze_received` vs the `stone_*` ladder; same root cause as the Design fix above). `deriveStoneStatus`/`_bronzeStonePlan`/`setOrderStoneStatus` (now key-fetch-first async) + `orderStatusWritePlan('stone', code, job)` are vocabulary-aware. New bronze-only `received` code in STONE_STATUS; **`stoneStatusOptions(job)`** filters the dropdown (bronze → Not ordered / Ordered / Received; others never see 'received'). Consumers updated: OrdersTab, OrderDetail, field JobDetailScreen ladder. `setBlockReason` reads `bronze_received` as the production gate on bronze ("Bronze not received"). Column header renamed **"Stone / Bronze"**.
- **Red not-started tones** — `paymentStatusTone('quoted')`, `designStatusTone('not_created')`, `stoneStatusTone('not_ordered')`, `fdnStatusTone('not_in')` → `'bad'` (the CALL-chip red, existing `.sb-tw-perm-bad`/`.sb-od-tone-bad`); FDN `'na'` stays neutral. Field app gained `.fl-c-bad` + TONE_CLS entry.
- **Manual blocker** — `orders.manual_blocker` jsonb (**migration `20260714_manual_blocker.sql` ✅ APPLIED**): `{ kind: needs_call|needs_email, note, setAt, setBy }`. `setOrderManualBlocker` + `MANUAL_BLOCKER_KINDS` in stonebooksData. Renders red kind chip (callpill style) + amber note chip on OrdersTab rows and board cards (suppresses the derived Call chip while set); edited via `ManualBlockerControl` in the OrderDetail status card ("Blocker" cell: add / click-chip-to-edit / Clear).
- **Editable job type** — OrderForm's type pills are no longer `disabled={isEdit}`; the wizard's Step-1 cards were never locked. **`syncJobToOrderType(orderId, serviceTypes)`** (stonebooksData, after buildMilestoneListForOrder) runs in **saveOrder's update branch** (non-fatal; result returned as `res.jobTypeSync`, surfaced as an error by OrderForm): when derived job_type/service_kind changed, the job's checklist is REPLACED from the new template with **carry-over of `contract_* / deposit_* / paid_in_full / permit_* / foundation_*`** (Paul's "fresh checklist, keep the basics"); design/stone/production progress resets by design. Restore-on-failure re-inserts the old rows; jobs row gets new job_type/service_kind/template_id + an addJobNote audit line. No job yet → no-op.
- **Note:** the FOUNDATIONS-LIST board + Installation gates read the same milestones, so Paul's master-override rule holds: FDN "in" drops the job off every foundations-needed surface.

## Sprint COMBINED-ORDERS (2026-07-14) — SHIPPED

Multi-service orders end-to-end (Paul: "some orders are inscription AND acid wash").

- **`combineOrders(primaryId, otherIds)`** (stonebooksData, after syncJobToOrderType) — merges same-customer+same-family orders into the primary (signed first, else oldest): service_types union (primary first, keeps its job_type), payments[] concatenated (each stamped `combined from E-26-XXXX`), each absorbed order's engine grand total becomes ONE manual `kind:'other'` add-on line (exact money, no re-pricing/double-count), notes stamped. Primary job re-templates to the union via syncJobToOrderType (pipeline gains both workflows) + max-progress merge (absorbed jobs' DONE milestone keys marked done on the primary job). Absorbed orders are **archived** (not deleted; their jobs left in place — archived orders' jobs are already filtered off every surface), activity logged on all. Server re-checks the same-customer/family gate.
- **OrdersTab bulk bar: "Combine into one order"** — appears when 2+ selected rows share customer_id + primary_lastname (none archived); confirm modal names the primary + absorbed; runs through the standard runBulk/confirm; errors alert loudly.
- **OrderForm multi-select job type** — the type pills TOGGLE (min 1). Combo helpers (comboServiceTypes/Sections/DeceasedVariant/AddonKinds) union each facet; `inferTypes` seeds the full set from order.serviceTypes on edit. Template preview + save use the union (getOrderMilestoneTemplate already merges secondary-service milestones). Wizard Step 1 was already multi-select.
- **Display:** `orderTypeLabels(order, job)` (plural) — Orders-table Job Type cell stacks one label per line; OrderDetail header + Type field join with ' / '.
- **NOT undoable in one click** (modal says so); the archived originals keep full history + a pointer note.

## Sprint TODAY-GOD-MODE (2026-07-14) — SHIPPED

Full TodayTab rebuild as the failsafe screen (Paul-approved concept artifact). Doctrine: every commitment is a RECORD (owner + age + status); a loop leaves only by resolution or snooze-to-date; approvals are PROVEN sent against the outbound mail record; "Needs you" prints the rule per row.

- **Migration `20260714_shop_tasks.sql` ✅ APPLIED:** `shop_tasks` (assignee, optional order_id, due_date, status open|done, snoozed_until) + `shop_task_replies` (author/body/handled_at — reply = inbox item for the other side until handled) + `approval_links.emailed_at/emailed_to`. Three-role RLS parity on both tables.
- **Staff identity:** `STAFF_NAMES` (Lonnie, Catherina, Denise, Chelsea, Paul, Collin, Alex, Sabina, Leo) + `get/setActiveStaffUser` (localStorage `sb_active_staff`); **`getCurrentStaffName` prefers the picked person** — every actor stamp app-wide names who really did it. Picker = "I am" pill row atop Today.
- **Approval email proof:** OrderDetail's composer stamps `approval_links.emailed_at/emailed_to` on real send (both Send-for-approval and Email-link paths carry `approvalLinkId`); `listAllApprovalLinks` + `getApprovalEmailEvidence` (outbound messages containing '/approve/', matched by share_url) drive the Today "Approvals out" panel — green "Email verified — sent X to Y" vs red "NO EMAIL ON RECORD". Real-data audit that motivated it: 7 links ever, only Hutchinson ×2 ever emailed; Medina ×4 since Jun 29 + Yager never emailed.
- **New TodayTab** (`src/TodayTab.jsx`, `.sb-td2-*`, old money-briefing版 replaced): I-am switcher → Open-loops ledger (approvals/calls/tasks/promises/permits + total) → Self-check (5 client-side audit checks: signed-no-job, approvals-never-emailed, links-expiring-48h, check-payments-no-ref, jobs-stale-14d; Fix buttons deep-link) → Yesterday band (batches+tasks planned/done/slipped, slipped chips) → Needs-you (rule text per row: approval-never-emailed, viewed-no-answer≥3d, red pressure blockers, manual flags, unsigned>14d) → Approvals-out (verified) → Today's schedule + Tomorrow (work_batches ±1 day) → Shop pulse (in-shop / ready-to-set / foundations-list / calls-owed) → Tasks ("task me" capture with assignee+optional order+due; replies inbox for the active user; All / By-employee views; done/reply/snooze-to-tomorrow/delete).
- **Money moved to Reports:** new `MONEY_PULSE` report (money group, daily-pinned) — collected in range, payments in, owed, orders owing + CSV of owers. Today carries a "Money moved out" marker.
- **Deep-link:** Today's Open-order buttons use new `onOpenOrderDetail` prop (Stonebooks wires `setOrderDetailId + setTab('orders')`).
- **Deferred:** permit-ledger cross-check in Self-check (needs an RPC — jsonb cross-join too heavy client-side); loop-chip drill-through filters; weather chip.

## Sprint TASK-COMMAND-CENTER (2026-07-15) — SHIPPED

Full Today rebuild as the TASK COMMAND CENTER (Paul: dad's sticky-note crisis; "tasks created in leads and other areas MUST show up in Today — don't want anything getting lost"). Design approved via mockups first.

- **Migration `20260715_employees.sql` ✅ APPLIED:** `employees` table (name unique/tenant, department, sort_order, is_active soft-delete, 3-role RLS) seeded with the 11-name union of the two old hardcoded rosters (Cathy≡Catherina seeded as 'Catherina'). **`src/lib/employees.js`** overlays active names INTO `STAFF_NAMES` + `TEAM_ROSTER` in place at boot (salesOptions pattern; zero-row fetch never blanks the rosters). `DEPARTMENTS` = Admin/Design/Sales/Production/Installation (fixed vocabulary, also valid task assignees). **Settings → Staff** (`src/components/StaffSettings.jsx`, owner-gated edit): add / inline-rename / department / deactivate+reactivate. `team.js` gained `getDefaultPromiseMaker()` (Cath-prefix match) — AddPromiseModal uses it.
- **Migration `20260715_task_command_center.sql` ✅ APPLIED:** `shop_tasks` is the ONE task store. New: `tasked_by` (defaults to creator, overridable), `assignee_kind` person|department, `task_type` (general/lead/order/design/layout/production/check_job — soft vocab, no check), status gains **'pending'**, `attachments` jsonb, `details` jsonb (check_job: cemeteryId/cemeteryName/notes; rail tasks: phase), `deleted_at/by` (**soft delete — anyone may delete; trail kept**), `legacy_activity_id` unique. **Backfill: all 42 order_activity type='task' rows copied in (verified 42/42)**; originals left dormant; `getOrderActivity` now excludes type='task'.
- **Helper repoint (stonebooksData):** `addOrderTask`/`getOpenTasksList`/`getCompletedTasksList`/`getOpenTasksForOrders`/`getDueOpenTaskCount`/`setOrderTaskStatus` keep their signatures but read/write shop_tasks via `asLegacyTaskRow` adapters (note↔title, in_progress↔pending, kind↔task_type, field↔details.phase) — LeadsView/DesignHub work unchanged. New: `updateShopTask` (anyone edits any task), `setShopTaskStatus` (open|pending|done), `listShopTasksForOrder`, `listCheckJobTasks`, `uploadTaskAttachment` (order-linked uploads go into `attachments/{orderId}/` so they ALSO appear in the order's attachment list; free tasks → `attachments/tasks/{taskId}/`).
- **New TodayTab (`.sb-tcc-*`, god-mode版 replaced):** ONLY tasks (self-check/needs-you/approvals-out/open-loops/yesterday/pulse all removed per Paul). Kept "I am" picker (feeds tasked_by auto-stamp; hover the stamp to override). Views: **List** (day strip All/Overdue/today+4/No date w/ counts; filters who incl. departments/type/show-done; expandable row = edit-anything + reply thread w/ seen-by + attachments incl. pick-from-order-files) · **Week board** (Planner buckets: Overdue + 5 days + No date; drag card→day reschedules via due_date) · **By person** (person + department columns) · **Dashboard** (what YOU assigned: metric cards + per-person stacked open/pending/overdue/done bars). New-task form: searchable order/lead link picker (lead = unsigned draft/scoping/quoted), general+link auto-types to lead/order.
- **Check jobs** (= site inspection before a repair quote) are shop_tasks `task_type='check_job'`. `CheckJobModal` (assignee, cemetery typeahead, due, notes, multi-photo → order attachments when linked) opens from: **lead ⋯ menu** (LeadsView), **"Save + check job"** button in NewLeadModal (saves lead then hands off), **order quick action** (OrderDetail). **Jobs → Check jobs tab** (`src/CheckJobsBoard.jsx`, JOBS_TABS code 'checkjobs'). Leads roster shows a green "Check job" tag on leads with one open; task table shows a Check job chip.
- **OrderDetail:** rail + activity timeline read tasks from `listShopTasksForOrder` (module-level `taskViewRow` adapter); timeline merges activity + tasks by created_at; task delete = soft `deleteShopTask`. **DO NOT create tasks via raw `logOrderActivity(type:'task')`** — they'd be invisible now.
- **Sales tab:** Leads task table sortable by **Assigned to**; orders toolbar gained **"Created by"** filter over `orders.sales_rep` (distinct values actually on orders). Lead/NewLead assignee pickers now use the live roster (STAFF_NAMES) instead of SALES_REPS.
- **Deferred (Paul will spec):** auto-tasking rules (e.g. closeout photo upload → auto-task Admin to close out the order).

## Sprint PERF-1 (2026-07-15) — SHIPPED

Paul-approved perf pass (analysis-first per his hard rule after a past data-loss incident: READ-ONLY investigation → report → approval → slices). NO stored data touched anywhere.

- **Bundle split:** React.lazy every tab (Stonebooks.jsx; Today stays static) + every route (App.jsx — its static SalesMode import was pinning the wizard into entry). `loadPricingConfig` → dynamic import (order preserved: pricing → salesOptions). **Entry chunk 1,988KB → 631KB (gzip 480 → 172).**
- **getJobs narrowed** (the shared hotspot — Orders/Jobs/Customers all mount it): `order:orders(*)` ×3 traversals → single embed of `JOBS_ORDER_EMBED` (audited exhaustive consumer column list + ORDER_PRICING_COLUMNS contract; deceased/field_location/plot_*/target_completion_end_date are load-bearing — NOT in ORDERS_BOARD_SELECT) with customer/cemetery nested inside, hoisted top-level in the flatten. Select validated against prod PostgREST (200).
- **TodayTab select trimmed** (identity/lead fields only); **getEmailThreadsWorkspace drops body_text** (snippet column covers the list; bodies load on thread open); **`messages(received_at desc)` index APPLIED** (`20260715_perf_indexes.sql`) — prod pg_indexes audit showed orders/jobs already carry their hot-path indexes (created OUTSIDE the migrations folder — don't trust migration files for index existence, query pg_indexes).
- **Not touched (deliberately):** computeOrderPressure/enrichment (already O(n)+memoized); Payments/Customers fetchAllPaged `deceased` selects (display-risk vs small win — revisit only if still slow).

## Fix: design change-request loop visible (2026-07-15)

Paul: customers' requested changes were invisible; Design Hub rows went to the job packet, not design details. **The feedback was stored all along** — `approval_links.change_notes` + `changes_requested_at` + the `changes_requested` status (all applied to prod OUT-OF-BAND, no migration file documents them; base migration constrains status to pending/viewed/signed/expired/revoked — the live check constraint differs) and `job_events` `proof_changes_requested`; read helpers `getLatestChangeRequestNote(s)`/`getChangeRequestThread` existed unused-by-the-card.

- OrderDetail Design/proof card: "Changes requested" red panel at top (full thread via getChangeRequestThread, deps on approvalLinks); change_notes inline on rejected link rows (`getApprovalLinksForOrder` now selects it); persistent "Open Design hub" button; `initialAction='design'` scrolls to `#od-design`.
- DesignHubHome: row click → `onOpenOrder(id,'design')` (order design card, deep-linked) with a secondary "Job packet" button preserving the old JobDetail path; per-row approval-link badge (latest link per order via listAllApprovalLinks); revision rows show the customer's note as text (was title-tooltip only). Stonebooks JobsTab wiring passes `(id, action)` through onOpenOrderDetail.

## Payments: owner-review REMOVED + Job view KILLED (2026-07-15)

- **Payments count immediately.** SalesMode addPayment creates `locked: true` (was locked:false drafts needing owner Submit — the Kovacs check sat in draft and a paid-in-full signed order never left Leads). Migration `20260715_lock_draft_payments.sql` ✅ APPLIED locked the one stranded draft (before-image in `_payment_draft_lock_backup`). Draft/Submit plumbing is dormant, not deleted.
- **JobDetail is packet-only.** The milestone-ladder Job view is dead (Paul: "old, redundant, ugly"). JobDetail (JobsTab.jsx) renders DesignPacket unconditionally (`onChangeTab` undefined hides the pill pair); the ladder/hero/promise-strip/EventLog/PnL render below the packet return is unreachable dead code. Job clicks route to the RECORD via `getJobLinkIds(jobId)`: order_id → OrderDetail, cemetery_order_id → CemeteryOrderDetail, neither → packet. Chokepoints: `JobsTab.handleOpenJob` (all in-tab surfaces) + `Stonebooks.openJobSmart` (Scheduler/Calendar/Reports/Profit/⌘K). `tab='design'` (Design hub rows, OrderDetail "Open related job") still opens the packet. LOST with the ladder (resurrectable, components intact): per-milestone editing beyond the master dropdowns, job event log, JobPnLPanel/JobDimensionsPanel mounts, job-page promise strip.

## CURRENT STATE (as of d11d3c4)
- HEAD: d11d3c4 PROFIT-VISUAL + loading-hang fix, pushed, Vercel green
- Migrations applied to prod A–K: service_kind, mausoleum_door template (corrected teams), [C dropped via G], door_index, dropped jobs.order_id unique, cemetery_orders + jobs.cemetery_order_id XOR, dropped orders.mausoleum_door_intake, cemetery_orders overrides/toggles, financial_records ledger (RESTRICT FKs), profit dimensions + job_cost_estimates
- Live tables: jobs, orders, cemetery_orders, financial_records, job_cost_estimates, job_milestones, job_promises, job_events, milestone_templates, cemeteries
- Storage buckets: cemetery_packets, receipts (both private)
- Active sprint: TODAY-COMMAND-CENTER (redesign Today tab as operational briefing — 4 design directions under review, not yet built)
- Parked: Profit visual demo-match, family-order payments→ledger, QBO bridge (columns dormant), scheduler workflow-grid completeness, test-data cleanup (ZZ_DEMO noise), SalesMode emoji purge (~20 icon cards incl 🚪)

## Architecture — operational lenses (locked 2026-05-28)

- **Customers** = relationship lens. People, family history, contact, repeat indicator, lifetime value. Office staff + sales primary surface.
- **Orders** = money/contract lens. Pipeline, balances, payments, deposits. Office staff + owner primary surface.
- **Jobs** = production lens. Milestones, blockers, stage, crews, readiness. Production staff + scheduler primary surface.
- **Today** = aggregate owner briefing.
- **Profit** = aggregate financial intelligence.
- **Scheduler / Calendar** = production execution + dispatch.

Same families appear in multiple tabs — different operational questions per surface. Tabs are NOT redundant; they are distinct lenses on the same business. Future work should sharpen each tab's primary question, NOT merge them.

Multi-role design target: office (Orders + Customers), production (Jobs + Scheduler), owner (Today + Profit), installers (Calendar Day dispatch).

---

Staff-facing CRM for Shevchenko Monuments (Perth Amboy, NJ, est. 1919).
React + Supabase. Internal use only.

## Operational locks

- Shevchenko tenant UUID: `a1b2c3d4-e5f6-7890-abcd-ef0123456789` (default for every new `tenant_id` column)
- NJ sales tax: 6.625%
- Sprint naming convention: `3o → 3p → 3q → 3r → 3r.2 → 3s → 3s.3 → 3u → 3v → 3w → 3x → S1 → M2-P1 → M2-P2 → M2-P2.1 → M2-P3 → M2-P4 (M2 COMPLETE) → L2-P1 → L2-P2 → L2-P3 → L2-P4 (L2 COMPLETE) → OWNER-CARDS → SCHED → SCHED-UI → CAL-DRAG → WORKFLOW-COMPLETE`
- Design tokens: Inter + JetBrains Mono, bronze accent on near-black `#0F1419` sidebar
- Staff never touch Supabase directly — all DB ops go through the app
- Photo storage: Supabase Storage bucket `key photos` (URLs already live; slugify filenames before SaaS launch)
- Base sizing math: round up to nearest whole inch; supplier cuts to whatever spec we give

## Workflow rules (important — follow these)

- **Plan before code.** Always describe the change before writing it.
- **Wait for explicit "go"** before editing files. Don't start patching just because the plan was acknowledged.
- **One thing at a time.** Don't bundle multiple bugs or features into one patch.
- **Confirm file receipts by name** when files are shared.
- **Ship as zips with non-technical install steps** for the user (Paul) to apply.

## Audit lessons (corrections from prior mistakes)

- **RLS-protected tables are invisible to the anon key.** The publishable anon key (`sb_publishable_...`) reads tables as the `anon` Postgres role. Any table with a policy granted only to `authenticated` (e.g. `using (true) to authenticated`) returns **0 rows** to anon — even when rows exist. **This is silent: no error, no permission denied, just an empty result set.** Currently known authenticated-only tables: `work_batches`, `work_batch_jobs`, `job_promises` (all via `supabase/migrations/20260527_scheduler_rls.sql`). Other tables (e.g. `orders`, `job_milestones`) appear anon-readable in prod and audited correctly.
- **Audit rule:** any prod data audit of an RLS-protected table must run in **Supabase Studio's SQL Editor** (authenticated session) or via a service-role key — NEVER via `curl`/PowerShell with the publishable anon key. The 2026-05-28 scheduler audit reported "0 work_batches / 0 work_batch_jobs / 0 job_promises" and concluded the scheduler had never been used. That was an **RLS false-negative**: 40 `work_batch_jobs` rows actually existed (surfaced 2026-05-28 when Migration L was applied). The SCHEDULER-COMPLETE sprint shape was reframed accordingly.
- **Pre-audit checklist for any RLS table:** (1) read the table's RLS policy migration to see who's allowed, (2) if it's `authenticated`-only, ask the user to run the probe in Studio rather than running it yourself, (3) document the visibility limit in the report so downstream conclusions don't depend on the anon view.
- **`npx vite build` ≠ `npm run build`.** The repo's `npm run build` script is `npm run lint && vite build` — Vercel uses `npm run build`, so it runs lint. Local `npx vite build` skips lint and will pass even when the lint step would fail Vercel. The 2026-05-28 Phase 5 push failed Vercel on a React 19 purity-rule error (`Date.now()` called inside a render body in `WeekWorkbench.jsx`) that local `npx vite build` happily allowed. **Always run `npm run build` before pushing**, not `npx vite build`. The React 19 hook lints (`react-hooks/purity`, `react-hooks/set-state-in-effect`) are strict — bare `Date.now()` / `new Date()` / `Math.random()` during render is an error, not a warning.
- **`orders.primary_lastname` is a `GENERATED ALWAYS` column** computed from `deceased[0].lastName` in the `deceased` JSONB array. Direct `UPDATE orders SET primary_lastname = '...'` will fail (or silently no-op depending on driver). To rename a deceased person's surname on an order: `UPDATE orders SET deceased = jsonb_set(deceased, '{0,lastName}', '"NewName"'::jsonb) WHERE ...` — the generated column auto-recomputes. The 2026-05-28 DEMO-DATA-CLEANUP Phase C Transaction 2 surfaced this when Studio ran the `SET primary_lastname=...` shape from the planned SQL. **Pre-flight rule for any prod write touching `primary_lastname` (or any column you didn't explicitly create)**: query `information_schema.columns` for `is_generated = 'ALWAYS'` on the target columns BEFORE building UPDATE statements. Other generated-column candidates worth checking before touching: any `*_lastname` / `*_total` / computed search fields.

## Stack

- Frontend: React (Vite), single-page app
- Backend: Supabase (Postgres + Auth + Storage)
- Hosting: Vercel — auto-deploy is wired and healthy; every push to `main` triggers a Production build (last verified deploy `6878902`, 2026-07-20). **The LIVE public domain is `https://stonebooks-beta.vercel.app`** (confirmed 2026-07-20 via approval_links share_urls + a live API probe). **URL gotchas:** `shevchenko-catalog.vercel.app` AND `stonebooks.vercel.app` are both STALE sibling projects — neither updates on push (cost a false "deploy failed" alarm 2026-07-15). The live project is under the `pvvargas12-1236s-projects` Vercel team; its per-deploy `stonebooks-*-pvvargas12-1236s-projects.vercel.app` URLs are SSO-protected. **To verify a deploy without the dashboard: query the GitHub deployments API** (`repos/pvvargas12-eng/stonebooks/deployments` + statuses; the git token in Windows Credential Manager target `git:https://github.com` works as a Bearer token) — `state=success` on env=Production is the signal.
- Key file: `src/SalesMode.jsx` is ~11k lines and holds the sales wizard

## What's shipped

- Today dashboard with action items
- Customers, Orders, Calendar (cemetery deadlines + target dates)
- Reports
- Full Sales wizard (6 carving/add-on categories: Flat Carve, Shape Carve, Hand Sculpted, Laser Etching, Vase, BLING — all configurable end-to-end)
- Theming, auth

## Sprint 3o — SHIPPED

All four items closed:

1. **Shape Carved bug** — ✅ fixed in 3o cleanup commit (`shapeOpen` picker state added)
2. **Laser Etching bug** — ✅ same fix, shared root cause (`laserOpen` picker state added)
3. **Hand Sculpted photo** — ✅ folded into Sprint 3p.1 (`MARKETING_PHOTOS.sculpted`)
4. **Laser Etching photo** — ✅ folded into Sprint 3p.1 (`MARKETING_PHOTOS.laser`)

Photo URLs (note the spacing/casing — fine for now, slugify before SaaS):

- Flat Carve: `Flat Carving Key Photo.jpeg`
- Shape Carve: `Shape Carving Key Photo.jpeg`
- Hand Sculpted: `hand sculpted key photo.jpg`
- Laser Etching: `laser-etching-key photo.jpg`
- BLING: `key bling photo .jpg` (trailing space)
- Vase: `Vase Key Photo .jpg` (trailing space)

Full Supabase URLs:
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Flat%20Carving%20Key%20Photo.jpeg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Shape%20Carving%20Key%20Photo.jpeg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/hand%20sculpted%20key%20photo.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/laser-etching-key%20photo.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/key%20bling%20photo%20.jpg
- https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/key%20photos/Vase%20Key%20Photo%20.jpg

## Sprint 3p — SHIPPED

Added Vase + BLING as add-on cards #5 and #6. Final add-on categories: Flat Carve, Shape Carve, Hand Sculpted, Laser Etching, Vase, BLING.

### Phases

- **3p.1** — ✅ SHIPPED. `MARKETING_PHOTOS` constants block; hand-sculpted + laser-etching photos refactored to read from it; BLING + Vase added as cards #5 and #6 with "Coming Soon" placeholder modal.
- **3p.2** — ✅ SHIPPED. BLING configurator: 3 sizes (Small $695, Medium $745, Large $795), 20 design options, 11 installed-example reference photos, 21-color picker defaulting to "Match stone color" with inline "Change" link. Color upcharge derives from `GRANITE_COLORS.premium` (single source of truth). Examples gallery modal reuses the `sm-pdf-preview-overlay` shell.
- **3p.3** — ✅ SHIPPED. Vase configurator. Three-step flow: size → shape → color. 6 sizes with locked pricing, 18 shape thumbnails, 21-color picker (same Match-stone Pattern A as BLING). Live base-width recommendation eyebrow updates reactively as vases are added/sized. Per-size fit indicators (✓ green / ⚠ yellow tight / ✗ red disabled). Fit-warning modal with Adjust / Override actions; override prepends a dated `[OVERRIDE: …]` stamp to `order.notes`. Die-width-driven recommended size carries a bronze "Recommended" badge.

### Vase pricing (as-shipped)

| Size | Volume (ci) | Price |
|---|---|---|
| 4×4×10 | 160 | $190 |
| 5×4×9 | 180 | $205 |
| 5×5×9 | 225 | $245 |
| 6×6×10 | 360 | $365 |
| 8×6×10 | 480 | $465 |
| 8×8×12 | 768 | $705 |

### Vase color upcharge

Granite schedule: Jet Black +25%, Bahama Blue +30%, Imperial Red / Mahogany / Royal Pink / Cats Eye +35%, rest at base.

### Vase shape thumbnails (18 unique URLs — as shipped)

https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/4-4-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/5-4-9-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/5-5-9-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/6-6-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/8-6-10-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/8-8-1-297x405.jpg
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape1-258x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape2-288x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape3-298x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape4-293x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape5-360x270.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape6-305x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape7-281x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape8-291x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape9-241x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape10-296x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape11-298x405.png
https://ibekfollqnytxcuyekad.supabase.co/storage/v1/object/public/Vase%20Shapes%20%26%20Styles/vase-shape12-300x405.png

### Vase fit verification math

- 1 vase: `base_W ≥ die_W + vase_W + 3"` (minimum); recommendation aims for 2" per gap → `ceil(die_W + vase_W + 4)`
- 2 vases (symmetric layout `[outer][vase][gap][die][gap][vase][outer]`): minimum `base_W ≥ die_W + 2×vase_W + 6"`; recommendation `ceil(die_W + 2×vase_W + 8)`
- Depth: `base_D ≥ vase_D + 2"`
- Reactive fit indicators on each size: ✓ green / ⚠ yellow tight / ✗ red disabled with "Increase base to X" caption
- "Recommended" badge on the largest size that gets ✓; that size is the default selection
- Warning popup if below 1.5" clearance — Adjust / Override; override prepends to order notes

## Available base widths

Supplier cuts to whatever spec we give. Recommendation rounds up to nearest whole inch.

## Open items still needing Paul's input

- Zelle QR upload (for 3q Zelle integration)
- baseWidth migration: ✅ resolved in 3p.3 by deriving width/depth from existing `order.baseConfig` (no new field added; legacy uprights without a base trigger an "add a base first" hint inside the Vase fit indicator)

## Sprint 3r — SHIPPED

Two-part sprint addressing the Design step filter bug and unifying BLING access.

### Part A — Category tabs
Replaced the hidden "Match shape + color / Browse all" toggle in DesignStep with a visible 6-tab category strip (Slants, Double Slants, Uprights, Double Uprights, Flat Markers, Custom Shape). Default tab derives from `order.shape` via the same code map as the retired `matchesShape` helper. Each tab shows a live count of matching designs. The color half of the old toggle was a real filter (`matchesColorFamily`) — preserved as an explicit "Also match my granite color" checkbox that only appears when a granite color is picked (opt-in, not silent narrowing).

### Part B — BLING tab
Added a 7th "BLING" tab. When active, the design grid is hidden and `<BlingConfigurator />` renders inline. Picks flow into `order.addOns` with the same `bling-{size}-{shape}` code pattern as the Add-Ons step — picks made in either surface show up in both. BLING tab has a gold accent and a picks-count badge instead of a catalog-count. BLING is never the default tab — only catalog categories map from `order.shape`. `updateAddOn` is defined locally inside DesignStep (same pattern as AddOnsStep:4399); no dispatcher changes.

### 3r follow-up — Tab data mapping fix
The cats values in the live monuments table use `upright-single` / `upright-double` / `flat` — the tab codes were originally written as `single-upright` / `double-upright` / `flat-marker` and hid **1222 designs** across three tabs (0 counts). Fixed in commit `bedfc16`. Same naming-mismatch was present in the pre-3r `matchesShape` helper too — so the original "Slant filter bug" from 3p.2 was actually "everything except Slants and Custom is empty."

## Sprint 3r.2 — SHIPPED

### Part A — All tab as default
Replaces the shape-derived default tab with a stable `'All'` tab at position 0 (full ~1648-design catalog). The fragile `SHAPE_TO_DESIGN_CAT` mapping is retired entirely. Tab strip: All · Slants · Double Slants · Uprights · Double Uprights · Flat Markers · Custom Shape · BLING. Default `activeCategory` is `'all'`. The Match-granite-color checkbox layers on top of any tab including All.

### Part B — Multi-select designs (6 max, primary + alternates)
Single `designId` / `designSnapshot` are replaced by `order.designs[]` — array of `{ id, snapshot }`, max 6. `designs[0]` is the PRIMARY (carver replicates this); `designs[1..5]` are ALTERNATES (inspiration only). Toggle behavior on card click; 3-second non-blocking cap notice on overage. New Selected-Designs panel shows per-entry thumb, role badge (gold PRIMARY / navy Alternate N), Make-primary on alternates, Remove, Clear-all. Removing the primary silently shifts `designs[1]` into the primary slot. Design grid cards wear matching role badges + bordered states.

**Schema change.** Orders table now has a `designs` JSONB column. The legacy `design_id` and `design_snapshot` columns are kept for backward read-compatibility — `toOrderRow` mirrors `designs[0]` into them on every save. `fromOrderRow` prefers `row.designs` when populated and falls back to the legacy columns for pre-migration orders. Migration SQL lives at `supabase/multi_design_migration.sql` and was written for manual execution (the app's anon key cannot run DDL).

**Estimate vs. contract.** Estimate continues to render the primary design only, relabeled "Design Reference (Primary)". Alternates do not appear in the estimate. **Contracts no longer render the design block at all** (per user direction in 3r.2 spec).

## Sprint 3s — SHIPPED

### Part A — Designer handoff section on step 12 (Saved)
New "Designs for the layout team" section on `ContinueLater` (step 12). Surfaces all `order.designs[]` entries with the same role badges (gold PRIMARY / navy Alternate N) and border colors as the step 7 selected-designs panel — read-only here (no Make-primary / Remove buttons). Footer reads "Primary only" / "1 primary + N alternate(s)" / "1 primary + 5 alternates (max)". Below the grid: a Designer Notes textarea bound to `order.designPreferences` (same field the step 7 "Describe what they want" textarea writes to) — **single source of truth across both steps**, no new column. Section stays editable post-signing on purpose: production handoff info isn't part of the signed contract.

**`designPreferences` stays on estimates** (gated `!isContract` on the PDF design block since 3r.2). Future sprint will surface a custom-design draft on the estimate so the customer can justify the spend to family — not yet.

### Part B — ADD_ONS_CATALOG duplicate cleanup
Removed the legacy `'24x14 M Unitized Vase Panel'` (`code: 'unitized-vase'`, $175) row from `ADD_ONS_CATALOG`. Sprint 3p.3's Vase configurator replaces it fully (6 sizes, 18 shapes, 21 colors, fit verification). Existing saved orders that carry `unitized-vase` in their `addOns` array still render — `buildLineItems` falls back to the addon's own `label` field when the catalog lookup misses, so there's no crash, no missing line item.

No other duplicates flagged. The catalog only contains 11 entries (custom-design fee, 3× lettering, 4× veteran setups, permit, 2× delivery). The Shape Carved / Laser / BLING / Vase configurators write dynamic codes into `order.addOns` at toggle time and don't pollute the catalog.

## Sprint 3s.3 — SHIPPED

PDF deposit/balance row overlap fix. The deposit block's label column at `W - M - 60` (60mm wide) was too narrow for the balance row label, which is ~58mm at 10pt and left only 2mm for the right-aligned dollar value. Result: leading digits visually mashed into the label tail (e.g. `$2,082.81` rendered as `$2,032.81` because the `8` got swallowed by the trailing `)` of `installation)`).

Widened the deposit-block label column to 90mm (`W - M - 90` = 109.9mm) and widened the gold divider above it to match. Right-aligned value position at `W - M` is unchanged. Other PDF rows in the upper totals block (Subtotal, NJ Tax, CC Surcharge, GRAND TOTAL) still use 60mm — their labels fit comfortably, so they were intentionally left alone. **Potential follow-up:** GRAND TOTAL's left edge is now 30mm to the right of the deposit/balance labels directly below it. Vertical misalignment is cosmetic, not a bug — only fix if the PDF reads visually off.

## Sprint 3u — SHIPPED

**Contract document overhaul.** Four parts, six commits.

### Part A — Estimated Due Date + delivery disclaimer (`2ae77ab`, revision `4c2750a`)
`calculateDueDate(order, anchorDate)` helper. Anchors on `order.signedAt` (or today for unsigned previews). Per-service lead times — NEW_STONE 5mo for `medium-barre-grey`/`mountain-rose` else 6mo, BRONZE 4mo, INSCRIPTION/ACID_WASH 8wk, REPAIR 3mo. CIVIC_MEMORIAL/ADD_PHOTO/OTHER have no defined timeline. MAUSOLEUM and all-null orders → "TBD — contact office". Mixed orders take the longest lead time. Contract-only PDF block after the order#/date row; estimates skip it. Unsigned previews show an italic "calculated from today" note. Delivery disclaimer (exact legal text) renders below.

- **Label is "Estimated Due Date"** (not "Due Date" as the original spec said) — an under-promise / over-deliver buffer, applied across all three cases (signed, unsigned, mausoleum TBD).
- **Domestic granites are `medium-barre-grey` and `mountain-rose` ONLY** — this is a *supplier-confidence risk buffer*, NOT the granite `family === 'gray'` rule. Everything else gets the conservative 6-month buffer, including the other grays (`legacy-gray`, `st-cloud-grey`, `cloud-gray`). `mountain-rose` is `family: 'pink'`. The rule is intentional and documented inline in `calculateDueDate`.
- **Mausoleum-specific due-date math is deferred** — currently shows "Estimated Due Date: TBD — contact office". The 6–8 month range picker UI was not built.
- **Two-color companion stones are not supported** — the order model has a single `graniteColor`, which drives the due-date math.

### Part B — 4-column line items (`464ac1a`)
2-column (Description/Amount) → 4-column (Description/Color/Qty/Rate) on both estimates and contracts. `buildLineItems` only returns `{code,label,amount}`, so Color and Qty are cross-referenced back out of `order.addOns`: `base-stone`/`color-premium` take `order.graniteColor`; addon rows take their own `blingColor`/`vaseColor`. The " × N" suffix `buildLineItems` bakes into addon labels is stripped from the Description (the Qty column carries it now). **Estimates show an em-dash for every per-item Rate** — protects per-item pricing from competitor lookup; the final total stays visible.

### Part C — Legal terms paragraph (`28b0c23`)
Contract `acceptText` replaced with 5 legal paragraphs (8pt, dark `TEXT` color, justified): 50% non-refundable deposit + balance due before carving work (carving work precisely defined), ownership until paid in full, removal authorization + reinstall $500 fee + legal fees on contested removal, change-order clause, 14-day acceptance window, finality + photography permission. Estimate branch keeps the "valid for 30 days" notice untouched.

### Part D — Page-break discipline (`682828d`)
Module-level `ensureBlock(doc, y, blockHeight, opts)` helper. Both PDF generators' local `ensure()` are now thin bindings of it. Per-block height reservations added in `generateEstimatePDF` (due date, stone specs, line items table, totals block; legal terms + signatures already reserved together by Part C) and `generateReceiptPDF` (payment-details table, running-totals block). **`ensureBlock` is reusable for any future PDF surface.**

## Sprint 3v — SHIPPED

**Sign step restructure.** Three parts + one follow-up, five commits.

### Part A — Contract preview iframe (`1716ad3`)
SignStep gets a "Contract preview" Section between the lock banner and the signature surfaces. Reuses `generateContractPDF(order, { returnDoc: true })` — which forces `mode: 'contract'` — so the preview is the exact contract layout (Estimated Due Date, 4-column line items, legal terms) even before signing. **Single source of truth — no duplicated layout logic.** Blob URL generated in a `useEffect` keyed on `isLocked` (regenerates once on lock to pick up embedded signatures; not per signature stroke), cleaned up via `revokeObjectURL`.

### Part B — Customer signature box + tap-to-open modal (`5e6f36a`), iframe follow-up (`51358bb`)
`CustomerSignatureBox` — empty state is a dashed "Tap to sign" box (bronze hover) that opens `SignatureModal`; filled state shows the signature image with a no-confirmation Clear button (pre-conversion clear is just "oops, redo"). `SignatureModal` wraps the existing `SignatureCanvas` in the `sm-pdf-preview-overlay` shell. **Customer signature is now a tap-to-open box; the rep signature pad stays always-visible while drafting; BOTH signature surfaces hide entirely when locked** (the preview iframe already shows the signed contract — no duplicate signature UI). Locked view is minimal: lock banner + preview + Download PDF + Unlock. Sections ordered rep-then-customer per spec. Follow-up `51358bb` enlarged the preview iframe to `min-height: 850px` for full-page visibility without internal scroll.

### Part C — Unlock signed contract (`06c13eb`)
"Unlock & Edit" Section in the locked view (below Download PDF), red/serious `.sm-unlock-btn` opening `UnlockConfirmModal` (red "Yes, Unlock" confirm, backdrop-click cancels). `handleUnlock` nulls the camelCase signature/lock fields, sets `status: 'draft'`, and appends an audit stamp to `order.notes`: `[CONTRACT UNLOCKED by ${salesRep} on ${date}: prior signature voided.]`. **Supabase Storage signature files are NOT deleted on unlock — only the DB references are nulled. Audit recovery from storage is possible if needed.** After unlock, `isLocked` drops to false, the preview regenerates signature-less, and both signature surfaces reappear empty for re-signing.

- **Pre-conversion Clear button has no confirmation** (just "oops, redo"). **Post-conversion Unlock has a full confirmation modal.**

## Sprint 3w — SHIPPED

**Target Completion Date wiring.** Two commits. **No migration needed** — the `target_completion_date` column already existed from Sprint 3i (it's read by CalendarTab, CustomersTab, and the dashboard); this sprint only wires it up.

### Part A — `calculateDueDateRaw` + auto-populate + recalc button (`498862e`)
New helper `calculateDueDateRaw(order, anchorDate)` returns `{ isoDate, isTBD }` — `isoDate` is `YYYY-MM-DD` (built from local date components, no UTC shift), `isTBD` is true for mausoleum / no-defined-timeline service mixes (`isoDate` null then). `calculateDueDate` now **wraps `calculateDueDateRaw`** — single source of truth for the lead-time math. Its `{ dateText, months }` shape is preserved for the contract PDF call site; `months` is no longer populated (it was never read downstream).

`ProductionTimelineSection` auto-populates `order.targetCompletionDate` on first visit to step 10 (Pricing) via a `useEffect` — fires only when the field is empty, the order is unlocked, and the service mix is not TBD. The null check makes it fire at most once per order; the existing 1200ms debounce persists it. A **recalc button** (↻, reuses `.sm-pricing-reset` style) sits next to the existing date input — recomputes from rules on click, disabled when locked, **hidden entirely for TBD service mixes** (clicking would only clear the field).

### Part B — Contract PDF reads the stored value (committed together with this CLAUDE.md update)
The contract PDF's DUE DATE block now **prefers `order.targetCompletionDate`** — formats the stored `YYYY-MM-DD` as "Month D, YYYY" (with a `T00:00:00` suffix to force local-midnight parsing and avoid a one-day timezone shift). Falls back to `calculateDueDate(order)` for legacy orders that pre-date 3w and for mausoleum / no-timeline orders where staff hasn't set a date manually.

**Behavior change:** the dashboard, calendar, and customer list will start showing target completion dates on orders that previously had blank ones — as staff open those orders to step 10 and the auto-populate fires.

## Sprint S1 — SHIPPED

**Mausoleum due date range.** Two commits. **Migration required** — `supabase/mausoleum_target_range_migration.sql` adds the new `target_completion_end_date` (`date`) column; **must be run manually in Supabase Studio**.

### Part A+B — range field + migration + step 10 range UI (`bb3b366`)
New field `order.targetCompletionEndDate` / column `target_completion_end_date` (added to `makeBlankOrder` + both row mappers). For mausoleum orders, `targetCompletionDate` is the **earliest** date in the completion window and `targetCompletionEndDate` is the **latest**; for non-mausoleum orders `targetCompletionEndDate` stays null.

`ProductionTimelineSection` branches on `isMausoleum`:
- **Mausoleum:** a `sm-grid-2` with two date inputs ("Target completion — earliest" / "— latest") and one recalc button on the latest field that resets BOTH dates. A new `useEffect` auto-populates the range on first visit when both dates are empty + unlocked: `earliest = anchor + 6mo`, `latest = anchor + 8mo` (`anchor` = `signedAt` or today), formatted from local date components. Dual null-check — clearing one date won't re-fire; clearing both re-fires as an intentional "reset to auto" path.
- **Non-mausoleum:** zero behavior change — the 3w single-date input, `calculateDueDateRaw`-driven auto-populate, and TBD-hidden recalc button are untouched. Mausoleum self-excludes the 3w effect via its existing `isTBD` check.

### Part C — contract PDF renders the range (committed together with this CLAUDE.md update)
The contract PDF DUE DATE block detects `isMausoleum && both range dates set` → renders `"Month D, YYYY – Month D, YYYY"` in the Estimated Due Date line. For the range case it also **suppresses** the "Calculated from today" unsigned-preview note (the range is staff-entered, not calculated) and **rewords** the delivery disclaimer from "on the due date" to "within the due-date window". Non-range / non-mausoleum contracts are unchanged.

**Propagation scope:** only the contract PDF renders the range. CalendarTab, CustomersTab, the dashboard, and the receipt PDF all keep reading `targetCompletionDate` (the start date) as a single date — no changes, no breakage. Extending those surfaces to show the range is left for a future sprint.

## Sprint M2 — Payment refactor (4 phases)

**Path B: full multi-payment refactor + Zelle + soft-delete.** Phased to keep each step shippable and reversible.
- **Phase 1 — data layer (SHIPPED).** See below.
- **Phase 2 — `PaymentTrackingSection` array-driven rewrite + mirror reversal (SHIPPED).** See below.
- **Phase 3 — consumers** (`CustomersTab` select list, `OrdersTab`, receipt PDF labels, reactive status logic) finished. Receipt labels: first = "Deposit Receipt", final (balance to zero) = "Final Payment Receipt — Paid in Full", middle = "Partial Payment Receipt #N".
- **Phase 4 — Zelle method + soft-delete with reason + Zelle receipt instructions.**

### M2 Phase 1 — SHIPPED — data layer only

**Migration required** — `supabase/payments_array_migration.sql` adds `payments jsonb NOT NULL DEFAULT '[]'::jsonb` on `orders`; **must be run manually in Supabase Studio** (no server-side backfill — read-fallback handles legacy data).

- **New field/column:** `order.payments` / `orders.payments` (JSONB array).
- **Payment record shape:** `{ id, amount, method, ref, receivedAt, createdAt, createdBy, note, voided, voidedReason, voidedAt, voidedBy }`.
- **Read-fallback:** `synthesizePaymentsFromLegacy(row)` builds `payments[]` from the legacy `deposit_*`/`balance_*` columns when the `payments` column is empty. Keyed off `amount != null` (matches UI gating). Handles the balance-only edge case (synthesizes a balance entry even when deposit is absent). Null `ref`/`receivedAt` are preserved, not fabricated; `method` defaults to `'check'` defensively. Synthetic IDs: `legacy-deposit-${order.id}` / `legacy-balance-${order.id}` — stable across reads.
- **`rowToOrder` read-fallback** mirrors the `designs[]` pattern: use `row.payments` when populated, else synthesize.
- **`orderToRow`** writes `payments` additively — the legacy `deposit_*`/`balance_*` writes are **unchanged and still authoritative** in Phase 1.
- **Phase 1 invariant:** the UI (`PaymentTrackingSection`, `recordDeposit`/`recordBalance`/`clear*`, receipt PDF, dashboard/customer rollups) is **completely untouched** — it still reads/writes the legacy two-slot fields. `payments[]` is a read-shadow only; the UI never writes it in Phase 1. Phase 2 reverses authority. **Any visible UI change from Phase 1 would be a bug.**

### M2 Phase 2 — SHIPPED — array-driven UI + mirror reversal

Three commits (`55b6748`, `c8bf0bc`, + the CLAUDE.md commit). **Authority reversed:** `payments[]` is now the source of truth; the legacy `deposit_*`/`balance_*` columns are write-shadows.

- **`orderToRow` mirror reversal:** the legacy `deposit_*`/`balance_*` columns are now **derived from** `payments[0]` and `payments[1]`. For `payments.length` 3+, only the first two are reflected in the legacy columns — consumers needing accurate totals must read `payments[]` (the `stonebooksData.js` helpers were patched to do so).
- **`newPaymentId()`** — the single `crypto.randomUUID()` call site.
- **`stonebooksData.js` helpers** (`rowDepositPaid`, `rowBalancePaid`, `rowTotalPaid`) now prefer the sum of non-voided `payments[]` entries when the array is populated, falling back to the legacy `deposit_amount`/`balance_amount` columns otherwise. The `!p.voided` filter is inert in Phase 2 (no void UI yet) but written for Phase 4. `rowBalanceDue` unchanged in structure — benefits via the corrected `rowTotalPaid`.
- **`PaymentTrackingSection` completely rewritten:** single **"Add payment"** button with a smart default (50% of grand total for the first payment, the remaining balance thereafter). Payment rows are **collapsed by default** (one-line summary + Edit/Remove + per-row `ReceiptActions`); clicking Edit expands an inline editor — **one row editable at a time** via a single `editingId` state. Rows are **sorted by `createdAt` ascending** (ledger order). **Ungated** — no `isLocked` check; payments stay editable post-signing. **Simple status trigger:** flips to `'paid_in_full'` when the non-voided sum reaches the grand total — **one-directional, no auto-revert on delete** (Phase 3 makes it fully reactive). Old `recordDeposit`/`recordBalance`/`clearDeposit`/`clearBalance` handlers and the two fixed deposit/balance blocks are removed.
- **`generateReceiptPDF` signature changed:** `generateReceiptPDF(order, payment, opts)` — was `(order, paymentType, opts)`. Reads this-payment fields from the passed `payment` object; running totals sum the whole non-voided `payments[]` array. Header label is a generic **"PAYMENT RECEIPT"** in Phase 2 (Phase 3 adds first/middle/final logic). `fmtDate` was hardened to slice-then-`T00:00:00` so `YYYY-MM-DD` `receivedAt` values don't shift a day.
- **`ReceiptActions`** takes `order` + `payment` (was `order` + `paymentType`); renders one toolbar per payment row.
- **Known limitation:** `CustomersTab.jsx` does not yet fetch the `payments` column (its explicit `.select()` list excludes it), so for orders with 3+ payments it shows only the first two in its totals until Phase 3 adds `'payments'` to that select. Every other consumer routes through `select('*')` or the patched `stonebooksData.js` helpers and is accurate.
- **Legacy-`id`'d synthesized entries** (`legacy-deposit-*`/`legacy-balance-*`) are preserved across edits — not re-`id`'d.

### M2 Phase 2.1 — SHIPPED — submit/lock model + receipt signature removal

Three commits (`bd818cb`, `c840b87`, + the CLAUDE.md commit). Adds an explicit **submit step** for payments — auto-save alone was wrong for money records.

- **`locked: boolean` field** on every payment. **Drafts** (`locked: false`) render in the list but don't count toward `collected`/totals and have no receipt; **locked** payments count and get a receipt. New payments start as drafts; **synthesized legacy entries** get `locked: true` (already recorded).
- **Read-time auto-lock:** `rowToOrder` maps `row.payments` with `locked: p.locked ?? true` — Phase 2-era payments (no `locked` field) normalize to locked, while explicit `locked: false` drafts survive. `stonebooksData` helpers also use `?? true` defensively, since they read rows directly via `select('*')` and bypass `rowToOrder`. **No DB migration** — read-time normalization + the defensive `?? true` cover every path.
- **`orderToRow` mirror filters to locked:** the legacy `deposit_*`/`balance_*` columns derive from `payments.filter(p => p.locked && !p.voided)` — drafts persist in the `payments[]` JSONB but never reach the legacy columns until submitted.
- **`PaymentTrackingSection`:** `collected` filters to `locked` payments (`visiblePayments` stays `!voided` only — drafts must render). New `submitPayment` flips `locked` false→true (the explicit commit). New `cancelDraft` — **fresh drafts** (from "Add payment", tracked in `freshDraftIds` Set) are deleted on Cancel; **re-opened drafts** (from Edit-unlock) restore a pre-edit snapshot (`editSnapshots` Map) and re-lock. Both `freshDraftIds` and `editSnapshots` are local component state, not persisted.
- **Confirmation modals:** Edit and Remove on a *locked* payment both open a parameterized **`PaymentConfirmModal`** (reuses the `.sm-unlock-modal*` CSS from Sprint 3v). Edit → confirm → snapshots the payment, flips it to draft, opens the editor. Remove → confirm → hard-delete (Phase 4 → soft-delete with reason). The row stays collapsed/locked-looking until the user confirms.
- **`statusPatchFor`** filter changed to `!p.voided && (p.locked ?? true)`; called from `addPayment`, `updatePayment`, and the new `submitPayment`. Still one-directional — no auto-revert when the locked sum drops (Phase 3 makes status fully reactive).
- **Draft visual:** `.sm-payment-row-draft` — gold-dashed border + soft bronze tint + a "DRAFT" pill. `.sm-submit-btn` — navy, gold on hover. `ReceiptActions` gated by `payment.locked`.
- **Receipt PDF signature block removed:** `generateReceiptPDF` no longer renders the customer/rep acknowledgment underlines or the "Received by" stamp. The closing note (thank-you / balance-due message) is kept; the section comment is relabeled `CLOSING NOTE`.

### M2 Phase 3 — SHIPPED — consumer updates + reactive status + receipt labels

Three commits (`ef9a38b`, `2624654`, + the CLAUDE.md commit). **Migration required** — `supabase/status_before_paid_in_full_migration.sql` adds `status_before_paid_in_full text` on `orders`; **must be run manually in Supabase Studio**.

- **New column / field:** `orders.status_before_paid_in_full` (text, nullable) ↔ `order.statusBeforePaidInFull` (camelCase). Stores the prior status when a payments-driven `paid_in_full` flip occurs; null otherwise. Plumbed through `makeBlankOrder` / `orderToRow` / `rowToOrder`.
- **`statusPatchFor` is now fully reactive** (was a one-directional flip). It reconciles `order.status` against the locked-payment sum: flips to `paid_in_full` + snapshots the prior status when `lockedSum >= grandTotal` (and `grandTotal > 0`, and not already paid, and not `closed`); **reverts** to `statusBeforePaidInFull` (or `'contracted'` fallback) when the sum drops below `grandTotal`; clears a stale `statusBeforePaidInFull` when status is no longer `paid_in_full`. The pre-existing vacuous `'completed'` guard (a non-existent status) was replaced with the real terminal status `'closed'`. `$0` grand totals never auto-flip.
- **Three handler gaps closed:** `cancelDraft`'s fresh-delete branch, `handleEditConfirm`, and `handleRemoveConfirm` now all call `statusPatchFor` — every payment-composition change reconciles status. `addPayment`/`updatePayment`/`submitPayment` already called it.
- **`OrderStatusChanger`** does NOT snapshot on manual `paid_in_full` — accepted; the `'contracted'` revert fallback covers those orders. `statusPatchFor`'s stale-snapshot cleanup handles a manually-changed status leaving a lingering snapshot.
- **`CustomersTab.jsx`:** `'payments'` added to the `.select()` column list; the per-customer `_totalCollected` rollup (was a raw `deposit_amount + balance_amount` sum) now uses `rowTotalPaid(o)`. Other CustomersTab sites + OrdersTab + dashboard already routed through the patched `stonebooksData.js` helpers and `select('*')` — no other consumer changes needed.
- **`generateReceiptPDF` receipt labels:** `nonVoidedPayments` filter tightened to require `(p.locked ?? true)` (drafts don't shift numbering or totals). The header label is now derived from the payment's position in the chronological non-voided-locked sequence + whether the order is fully paid *right now*: `DEPOSIT RECEIPT` (first), `PARTIAL PAYMENT RECEIPT #N` (middle, N = index among non-deposit), `FINAL PAYMENT RECEIPT — PAID IN FULL` (last AND total ≥ grandTotal), `DEPOSIT & FINAL PAYMENT — PAID IN FULL` (a lone payment that fully pays). "Final" requires the order to be fully paid *at render time* — a multi-payment order still short of grandTotal has no FINAL. Receipts regenerate on demand and carry no historical state, so the label always reflects the current ledger.

### M2 Phase 4 — SHIPPED — Zelle + soft-delete with reason + Zelle receipt instructions

Four commits (`0c2fc23`, `c33daac`, `56a07d5`, + the CLAUDE.md commit). **No migration** — the `voided`/`voidedReason`/`voidedAt`/`voidedBy` fields have existed on every payment object since Phase 1 (forward-engineered). **M2 multi-payment refactor is now COMPLETE.**

- **Zelle method:** `'zelle'` / label `'Zelle'` added at the 3 method-enum sites (the edit-row `SelectInput` options, `methodLabels` in `generateReceiptPDF`, the `methodLabel` helper in `PaymentTrackingSection`). The Reference field is method-aware — label `'Zelle confirmation #'` / placeholder `'e.g. 1234567890'` when `method === 'zelle'`, else the existing check-oriented copy.
- **Receipt PDF Zelle block:** renders between RUNNING TOTALS and CLOSING NOTE, gated on `!isFullyPaid` — navy `'PAY THE BALANCE BY ZELLE'` header, gold `shevcoteam@gmail.com` line, body with the `order #` memo instruction. Uses the existing `ensure()` discipline.
- **Soft-delete (void):** "Remove" on a locked payment is renamed **"Void"** and `handleRemoveConfirm` now `.map()`s the payment to `voided: true` + `voidedReason` (required) + `voidedAt` + `voidedBy` (`order.salesRep`) — *in place*, the payment stays in `payments[]` for audit. Existing `!p.voided` filters everywhere exclude it from totals. Drafts are still hard-Cancelled (they're not money records yet).
- **`PaymentConfirmModal`** extended for the `'remove'` variant: a required-reason `<textarea>`, `useState`/`useEffect` (reset-on-open) moved above the early return for hooks compliance, confirm button disabled until a reason is entered. Retitled **"Void this payment?"** with audit-aware body copy. `onConfirm(reason?)` — edit ignores the arg, void passes the trimmed reason.
- **Voided rows render** (they're no longer filtered out): `visiblePayments` is now the full sorted list; a new `activePayments = visiblePayments.filter(!p.voided)` memo powers `collected` and `addPayment`'s default-amount. The row `.map()` is a three-way branch — editing / **voided** / locked-collapsed. The voided row is collapsed-only: a red `VOIDED` pill (`#b3261e`), struck-through amount, an audit line *"Voided by {voidedBy} on {date}: {reason}"*, **no Edit/Void buttons, no `ReceiptActions`**. Styling: `opacity 0.6`, light-red wash, red border.
- **Empty state** stays gated on `visiblePayments.length === 0` (total, *including* voided) — a voided-only order shows its voided rows, not the empty state.
- **`generateReceiptPDF` guard:** throws `'Cannot generate a receipt for a voided payment.'` if called with a voided payment — defensive, surfaces through the existing async `catch` in `ReceiptActions`. `ReceiptActions` itself is gated by `payment.locked && !payment.voided`.
- **`statusPatchFor` unchanged** from Phase 3 — its `lockedSum` already filters `!p.voided`, so voiding a payment naturally drops it from the sum and reverts `paid_in_full` if needed. Void-driven status reactivity is free.

## Sprint L2 — Inscription tab overhaul (Tab 8)

Restructures the Inscription step (Tab 8) into a 6-section flow, relocates the per-person Title builder from the Memorial step (Tab 4), and propagates per-person inscription choices (carved name, date format) through to the contract/estimate PDF. **No DB migration** — every new field rides on the existing `orders.inscription` (order-level) and `orders.deceased` (per-person) JSONB columns; defensive `??` defaults in `rowToOrder` fill in for legacy rows.

### L2 Phase 1 — SHIPPED — schema/data-layer extensions (`90373b0`)

Pure plumbing, zero UI change. Extended `makeBlankDeceased` with per-person inscription fields (`nameDisplayVariant`, `nameDisplayCustom`, `dateFormat`, `dateFormatCustom`, `styleTreatment`, `styleTreatmentCustom`) and `makeBlankOrder.inscription` with order-level fields (`layoutStyle`, `layoutCustom`, `sideArrangement`, `sideToConfirm`, `sideNote`). `rowToOrder` now `.map()`s `row.deceased` with `??` defaults on each new per-person field, and the inscription read-fallback became a defensive merge (`{ …defaults, …(row.inscription || {}) }`) so legacy rows pick up the new keys without losing their existing data. `orderToRow` untouched — `inscription` and `deceased` were already written whole as JSONB.

### L2 Phase 2 — SHIPPED — PDF bug fix + Title builder relocation

Two commits.

- **Commit 1 (`e272645`)** — `pdfDeceasedLines` rewrite that finally surfaces deceased data correctly on the PDF. Fixed multiple pre-existing bugs in one pass: `d.middle` → `d.middleName` (middle names had never rendered), `d.birthYear`/`d.deathYear` → `slice(0,4)` of `d.dateOfBirth`/`d.dateOfDeath` (no date range had ever rendered on any PDF — the fields didn't exist), the `.code`/`.label` lookups on the plain-string `TITLE_PREFIXES`/`TITLE_RELATIONS` arrays (the prefix/relation strings only rendered via the `|| fallback`), title rendering changed from person-1-only to per-person, and title source switched from re-assembling `titlePrefix + titleRelations` to preferring `d.title` (the assembled/editable string) with re-assembly as fallback — staff free-text overrides of the final title now honored. Pre-need rendered as `b. YYYY`. Consumer block at the "In Memory Of" section was unchanged — it's `kind`-discriminated, so interleaved per-person title+name+dates render in order without modification.
- **Commit 2 (`60af54a`)** — Per-person Title builder moved from `DeceasedCard` (Tab 4) to `InscriptionStep` (Tab 8). New `InscriptionTitleBuilder` component (mirror of the deleted DeceasedCard logic — `joinRelations`/`setPrefix`/`toggleRelation` come along; `d.title` stays free-text-editable). Rendered as a `<Section title="Title / Relationship">` with one builder per non-reserved person via an idx-aligned map (`order.deceased.map((d, idx) => d.isReserved ? null : <Builder idx={idx} … />)` — critical: filter via `null`-return, NOT `.filter()`, so `idx` stays aligned to the real array index). Step-lede updated since "Title is set on the Memorial step" was now false.

### L2 Phase 3 — SHIPPED — 6-section Inscription tab build-out

Three commits.

- **Commit 1 (`833c722`)** — Layout section (§1 at the time, later §3) + ordering arrows + shared `formatPersonDates` helper. Added `LAYOUT_STYLES` and `SIDE_ARRANGEMENTS` constants, new `<Section title="Layout">` gated `!isInscriptionOnly` with a `CardOption` grid for `layoutStyle` + a conditional `layoutCustom` text field, a 2-person-only side-arrangement picker (`p1_left_p2_right` / `p1_top_p2_bottom` / `unknown`) whose `onChange` writes `sideToConfirm: opt.code === 'unknown'` in the same `updateInsc` call (so the boolean tracks the picker bidirectionally), an optional `sideNote` field that appears when arrangement is `'unknown'`, and a 3+-person `PersonOrderArrows` component that reorders the `order.deceased` array directly (adjacent-swap with leapfrog over reserved entries, `position` resequenced on every swap for DB tidiness). Title section relocated below Layout. New module-scope `formatPersonDates(d)` helper added above `pdfDeceasedLines` — reads `d.dateFormat`, formats via `slice(0,4)`/`parseInt` (no `new Date()` timezone risk), handles pre-need (`b. ${birth}`), all-blank, and `custom` (uses `d.dateFormatCustom`). Helper has zero consumers in Commit 1 — wired in Commits 2 and 3.
- **Commit 2 (`b0bb2c7`)** — Per-person Name/Date/Style sections + new `inscriptionName` field. Added `inscriptionName` to `makeBlankDeceased` (default `null`, defensive `??` in `rowToOrder`) — the stone-carved name, persisted independently of the legal name on Tab 4. New `InscriptionNamePicker` shows `assembledLegalName` as the default/placeholder; clearing the field back to `''` falls back to the assembled legal name in display. New `DateFormatPicker` renders a `CardOption` grid using `formatPersonDates({ ...d, dateFormat: opt.code })` to show a per-person preview using *that person's actual dates* (falls back to the constant's `blurb` reference sample when dates are blank). New `StyleTreatmentPicker` with 10 text-only treatments (no visual assets yet — `plain`, `scroll`, `banner`, `skin_frosted`, `panel`, `double_panel`, `panel_chip`, `old_english`, `special_font`, `custom`) plus a contextual `styleTreatmentCustom` field that appears on `special_font` or `custom`. Dropped `'top_bottom'` from `LAYOUT_STYLES` (same visual as Stacked); legacy orders with that value just render with no card selected. Refined Layout gating to `!isInscriptionOnly && (nonReservedCount > 1 || hasReserved)` — single-person orders without a reserved slot don't see Layout. Section order finalized: **§1 Name → §2 Title → §3 Layout (gated) → §4 Date → §5 Style (gated) → §6 Epitaph** (Epitaph repositioned to last). Inscription-only specific sections (type picker, photo, "what's going on" summary) and the `customFont`/Preview sections kept their existing positions interleaved.
- **Commit 3 (this commit)** — PDF + on-screen summary propagation. `pdfDeceasedLines` now prefers `d.inscriptionName` (Tab 8 §1 carved name) with a fallback to the assembled legal name; date rendering switched from the inline `buildDatesForPerson`/`yearFrom` helpers to the shared `formatPersonDates(d)` so the PDF honors each person's `dateFormat` choice. `InscriptionTextSummary` (on-screen Tab 8 summary for inscription-only flows) gets the same name-fallback + `formatPersonDates` wiring for consistency, and its filter now includes persons who have only `inscriptionName` set (no legal `firstName`). Title rendering in `pdfDeceasedLines` unchanged from L2 Phase 2 Commit 1.

**Design notes preserved for future work:**
- **D1a:** PDF reads `inscriptionName` first, falls back to assembled legal name — the contract represents what gets carved, not what's on the legal record.
- **D2 reversed:** by-section grouping (not by-person) — Name iterates persons, Title iterates persons, Layout (order-level), Date iterates persons, Style iterates persons, Epitaph (order-level). The by-person grouping mentioned in the diagnostic was rejected once the Name section became a simple text input rather than a card picker.
- **Phase 1 `nameDisplayVariant` / `nameDisplayCustom` fields are orphaned** — added in Phase 1 anticipating a card-picker UI; superseded in Phase 3 Commit 2 by the editable Name field. The fields remain in `makeBlankDeceased` and `rowToOrder` (defensive defaults stay) but no UI reads or writes them. Future cleanup sprint may remove.
- **`position` field is now actively used** — written by `removeOne` (pre-L2 behavior), now also re-sequenced on every `PersonOrderArrows` swap. Still no consumer reads it (array order is the de-facto truth everywhere); kept resequenced purely for DB tidiness in case a future sprint adds a sort-by-position consumer.

### L2 Phase 4 — SHIPPED — HTML/CSS preview, order-level format/treatment, family-name verification, SVG deletion

Six commits + one follow-up. L2 inscription overhaul is now complete end-to-end.

- **Commit 1 (`df65344`)** — hoisted `buildTitleForPerson` and `buildNameForPerson` from inside `pdfDeceasedLines` to module scope (now shared by PDF and preview). Added `splitTextToSize` wrap to the PDF "In Memory Of" title line — 3+ relations (e.g. "Beloved Father, Husband, Grandfather, Brother, & Uncle") no longer overflow the right margin. New **`InscriptionTextPreview`** HTML/CSS component — text arrangement only, no granite shape/size/color simulation per the locked Q3b decision. Replaced the `<PreviewPanel order={order} />` call site on Tab 8 with `<InscriptionTextPreview order={order} />`; the SVG `LivePreview` and `PreviewPanel` stayed in the file (deleted in Commit 6) but were no longer reachable.
- **Commit 2 (`5d4cf26`)** — refactored `dateFormat` + `styleTreatment` from per-person fields to **order-level** (`order.inscription.dateFormat`/`styleTreatment` + their `*Custom` siblings). Single picker each in Tab 8 §4 and §5; deleted the per-person `DateFormatPicker` and `StyleTreatmentPicker` components. `formatPersonDates(d, opts)` gained an optional second arg — when `{format, customText}` is passed (from the order-level fields), it overrides the per-person field. `pdfDeceasedLines` and `InscriptionTextPreview` both pass the order-level opts. Treatment label rendered once at the bottom of the preview (`.sm-itp-treatment-order`) instead of per-person. Per-person `d.dateFormat`/`d.styleTreatment` fields stayed in `makeBlankDeceased` + `rowToOrder` defensive defaults — **orphaned** but harmless; future cleanup sprint may remove.
- **Commit 3 (`d616b72`)** — `LAYOUT_STYLES` renamed `centered_last` → `centered_family_name` (consistent with new label "Centered Family Name") and reordered: **Centered Family Name first (new default)** → Side by side → Stacked → Custom layout. `makeBlankOrder.inscription.layoutStyle` default changed from `'side_by_side'` to `'centered_family_name'`. `rowToOrder` inscription merge wrapped in an IIFE that applies a post-spread legacy migration: rows saved with `layoutStyle: 'centered_last'` map to `'centered_family_name'` on load. New **Centered Family Name + 2-person + `p1_left_p2_right`** combo render: surname banner across the top + 2-column persons below with a thin vertical divider (`.sm-itp-side-by-side-with-divider` via `::before` pseudo-element). All standalone side-by-side renders also get the divider class. `InscriptionTextSummary` switched to read order-level `dateFormat` opts for PDF/preview/summary consistency. CSS renames: `.sm-itp-last-name-banner` → `.sm-itp-family-name-banner`, `.sm-itp-centered-last` → `.sm-itp-centered-family-name`.
- **Commit 4 (`4218734`)** — new **Year Name Year** date format (`'year_name_year'`, e.g. `1919  Paul V.  2020` — dates flank the name on a single line). Special-cased in `pdfDeceasedLines` (push `kind:'person'` with combined `name` and empty `dates`, so the consumer block skips the right-aligned dates branch), `InscriptionTextPreview` (new `.sm-itp-person-ynr` + `.sm-itp-year-name-year` divs in `renderPerson` short-circuit), and `InscriptionTextSummary` (same combined-line branch). Pre-need persons render as `b. {birth} {name}`; missing-date edge cases gracefully degrade. New module-scope helper `yearNameYearParts(d)` does ISO-slice year extraction. New **`order.inscription.familyName`** field — preview-only verification input at the top of Tab 8 §1, auto-populated from `computeFamilyNameDefault(deceased)` (shared surname when all match, else first person's lastName). `InscriptionTextPreview` Centered Family Name banner reads `familyNameForBanner = order.inscription.familyName?.trim() || computeFamilyNameDefault(...)`. PDF unchanged — `familyName` is preview-only by design.
- **Commit 5 (`f4c77a8` + followup `09c8b1d`)** — **simplification:** the `SIDE_ARRANGEMENTS` constant and the Side Arrangement `CardOption` grid in Tab 8 §3 deleted entirely. Person ordering arrows (`PersonOrderArrows`, Phase 3 Commit 1) now appear for **2+ persons** (was 3+) — array order describes who-goes-where (person[0] = left/top, person[1] = right/bottom). An explicit **"Inscription side not yet confirmed" checkbox** replaces the `SIDE_ARRANGEMENTS 'unknown'` path — writes directly to `inscription.sideToConfirm`. `InscriptionTextPreview`'s `sideArrangement` references all removed: `effectiveLayout = layoutStyle` (no more `p1_top_p2_bottom`-override-to-stacked logic); the Centered Family Name + 2-person + shared-surname combo render is now **unconditional** (no longer gated on `sideArrangement === 'p1_left_p2_right'`); the soft-indicator above the preview is driven by `insc.sideToConfirm` instead of derived from arrangement. `inscription.sideArrangement` field stays in `makeBlankOrder` + `rowToOrder` (orphaned, schema-compat for legacy data — same orphaning pattern used in Phase 3 for `nameDisplayVariant`). Followup commit reworded a comment so the deletion grep contract held.
- **Commit 6 (this commit)** — Phase 4 wrap. New **side-confirmation banner** at the top of `ContinueLater` (the Tab 12 saved view), reusing `.sm-existing-banner` styling, gated on `order.inscription?.sideToConfirm === true`; renders `⚠ Inscription side not yet confirmed — verify with customer or cemetery before production` with an optional `sideNote` second line. **SVG `LivePreview` and `PreviewPanel` components deleted** (~190 lines of JSX) — they had been unreachable since Commit 1; cleaned up with the surrounding pre-function comment header. Dead CSS removed: `.sm-preview-blocked*` (gate UI for the SVG preview), `.sm-preview-optin*` (opt-in button), `.sm-live-preview*` (SVG preview shell), and their `// ---- PREVIEW GATING ----` / `// ---- LIVE PREVIEW (SVG stone) ----` section comment headers. `InscriptionTextPreview` survives (definition + call site + comments). CLAUDE.md L2-P4 wrap (this section); sprint pointer advanced to `L2-P4 (L2 COMPLETE)`.

**L2 design notes preserved across all 4 phases:**
- **D1a:** PDF reads `inscriptionName` first, falls back to assembled legal name — the contract represents what gets carved, not what's on the legal record.
- **D2 reversed (Phase 3):** by-section grouping — Name iterates persons, Title iterates persons, Layout (order-level), Date (order-level), Style (order-level), Epitaph (order-level). The Phase 4 refactor moved dateFormat and styleTreatment to order-level, further simplifying the by-section model.
- **Q3b (Phase 4):** the preview is text-arrangement only — no granite shape/size/color simulation. The SVG preview's shape-visualization role was intentionally retired.
- **Side-arrangement simplification (Phase 4 Commit 5):** layout style describes the visual arrangement; array order (manipulated by ↑/↓ arrows) describes who-goes-where; explicit checkbox flags confirmation-pending. No more multi-way `sideArrangement` enum in the UI.
- **Orphaned-but-retained schema fields** — `d.nameDisplayVariant`, `d.nameDisplayCustom`, `d.dateFormat`, `d.dateFormatCustom`, `d.styleTreatment`, `d.styleTreatmentCustom`, `order.inscription.sideArrangement`. All stay in `makeBlankDeceased`/`makeBlankOrder` and `rowToOrder` defensive defaults for backward compatibility with legacy rows; no UI reads or writes them post-Phase-4. A future schema-cleanup sprint may remove.
- **Parked from Phase 4 mid-sprint discussions:** (a) **Name as Carved Family Name card option** — add a card to the Name picker that says "use the family surname for this person" (defers to the order-level Family Name). (b) **$750 Family Name on back of marker** add-on on Tab 9 — needs its own Tab 9 / add-ons diagnostic before specing. Both deferred to future micro-sprints.

## Sprint OWNER-CARDS — Owner attention cards + Sales hybrid view

**Owner Overview headline cards + a real Sales surface.** One commit (`fad7c72`). New files `src/components/OwnerAttentionListView.jsx` + `src/components/SalesView.jsx`; touches `JobsDepartmentView.jsx`, `JobsBucketCard.jsx`, `JobsQueueRow.jsx`, `JobsTab.jsx`, `lib/stonebooksData.js`. **No DB migration** — pure read-side derivation over existing jobs / orders / bulk_orders.

- **Two headline summary cards above the curated ten buckets** on Owner Overview: **"Tasks needing attention"** (amber count) and **"Tasks overdue"** (red count). Both **hide entirely when their count is zero** — quiet days look quiet. They sit in their own 2-col grid (`.sb-owner-summary-row`) above the curated grid so the hierarchy reads headline → curated; `JobsBucketCard` gains a `summaryStyle` variant (5px left border, 44px count) that inherits amber/red tone from the bucket's urgency.
- **`OwnerAttentionListView`** — clicking a headline card replaces the grid with a flat list (worst-first) of every amber / overdue milestone across all departments, each row carrying a **department chip** (new `row.department` on `JobsQueueRow`) so the owner sees which department is on fire at a glance. Click a row → JobDetail. The drill is **in-session only** (`attentionMode` state in `OwnerView`), not persisted to `workspaceState`; switching Overview ↔ All-departments clears it.
- **Data layer:** `getAllAmberTasks` / `getAllOverdueTasks` walk every department's bucket derivers, **dedupe by `milestone.id`** (a milestone qualifying for multiple buckets shows once), tag each row with `roleForMilestone`, skip non-milestone buckets (`bulk_order_list`), and sort worst-first (overdueDays → agingDays → surname).
- **Sales role: stub → hybrid summary** (`SalesView`) — deliberately **metric-shaped, not queue-shaped** (sales lives in the Orders tab pre-contract; forcing it into job-stage bucket cards "would feel like noise"). Three sections from one `getSalesSummary(orders)` derivation pass: **(1) potential revenue** across open estimates ($-formatted, with count + average), **(2) top-5 follow-ups due** with urgency tinting + a "See all in Orders →" button (reuses `getEstimatesNeedingFollowup`), **(3) recently won** (orders signed in the last 7 days). Recently-won reads `order.signed_at` — the same contract-signed timestamp `createJobFromOrder` uses — so the signal is **honest, no faked status-transition log**.

## Sprint SCHED — Scheduler substrate

**Operational scheduling layer — data substrate only.** Four migrations, **all applied to production manually in Supabase Studio on 2026-05-26/27 and verified live** (tables + columns present; RLS enabled with `authenticated`-all policies on all three scheduler tables; `work_batches_kind_check` carries all eleven kinds). Files live in `supabase/migrations/`.

### What shipped (data layer)

- **`work_batches`** — the unit of crew dispatch. Eleven kinds: nine workflow (`inscription`, `blasting`, `setting`, `delivery`, `acid_wash`, `repair`, `rub_grab`, `foundation_trip`, `door_trip`) + two ad-hoc event kinds (`site_visit`, `errand`) for zero-job calendar entries. Field trips carry `destination_cemetery_id` + stops; shop blocks don't. `scheduled_date` is NULL while in the pre-scheduling build tray. `status` ∈ `planned` / `in_progress` / `running_late` / `completed` / `cancelled`.

## Sprint DATE-1 — Payment/permit dates off by one day (2026-07-22, commit 2a76d2e)

Paul: "the date i select in permit for the payment is not the day thats showing sometimes its a day before or a day behind." Two directions of one timezone bug:

- **Day BEHIND (display):** shared `fmtDate`/`fmtRelative` in `stonebooksData.js` did `new Date('2026-07-21')` — bare date-only strings parse as **UTC midnight**, which is 8pm the previous evening in NJ. Fixed with `parseDateLocal` (date-only regex → `+'T00:00:00'` local parse). Heals every consumer: Payments › Outgoing, OrderDetail payments + permit fees + permit dates, Permit Hub, vendors.
- **Day AHEAD (writes):** `new Date().toISOString().slice(0,10)` "today" defaults are UTC — after 8pm ET that's tomorrow. New exported `todayISO(d?)` (LOCAL calendar day) in `stonebooksData.js`; every UTC-today straggler swapped (ExpenseModal, VendorsTab, vendorsData, OrdersTab, SalesMode receivedAt, InstallBoard, FoundationsBoard, CemeteryOrderDetail, promise cutoff, status_date, recordOutgoingPayment fallback). **Rule: never use `toISOString()` for a calendar-day default.**
- **Migration `20260722_permit_denied_date.sql`:** `orders.permit_denied_at` timestamptz → `date` (siblings filed/approved/expires were already date). Cast via UTC so existing date-only writes kept their intended day.

## Sprint FND-1 — Shevco foundation permit + attach-on-build + auto-tasks + real delete (2026-07-22, commit 729f37f)

- **Shevco Foundation Permit template** — blank extracted from Paul's letterhead paste (date erased via System.Drawing), `public/permit-forms/shevco-foundation/p1.png` (1700×2200). 18 fields: today_date, grave_location, labeled Die/Base size lines (`die_shape`/`base_size` autofill), Signed, customer_address, charges box (FDN / P&M Fund / Total / Check No — custom), and a labeled block for **Grave type** (Single / Double Deep / Side x Side / Cremains-full body — typed), **Stone type** (`shape` autofill: slant, grass marker, hickey, upright), **Foundation size** (typed). `layout_slot` is on the **back page** — that's where the grave map goes ("must have map"). `cemetery_id` NULL = generic, same as the Shevco Permit. Paul's uploaded `Foundation Form.pdf` is the internal worksheet whose fields informed the block; the letterhead permit is the template.
- **Attach-on-build (`attachPermitPdfToOrder` in `permitBuilder.js`):** Download/Print in the Doc editor upsert the built PDF to `attachments/<orderId>/permit-<docId>.pdf` (stable path — rebuilds REPLACE, never stack) + upsert the `order_attachments` row keyed by `storage_path` (`file_url` gets a `?v=` cache-buster). Storage feeds OrderDetail's list; the row feeds Permit Builder's own context panel.
- **`orders.permit_form`** (`20260722_permit_form.sql`): 'cemetery' | 'shevco'. New "Permit form" select in OrderDetail's Permit & Foundation card + quick-edit modal. Picking **shevco** — or setting Foundation by to **Our Foundation/Strip** — calls `ensurePermitBuildTask` (stonebooksData): dedup-checked (same title + order + open) auto-task to **department Admin** "Create Shevco …permit - FAMILY (ORDER#) (Permit Builder)". Push notification inside addShopTask is the auto-alert; activity log entry too.
- **Real delete:** `hardDeleteOrder` dropped the archive-first gate (Paul: delete directly from Orders and Leads; typed-DELETE confirms live in every UI). Root cause of "it wasn't letting me delete": **`jobs.order_id` and `financial_records` FKs are RESTRICT** — SalesMode's raw `orders.delete()` always failed once a job existed; now routed through `hardDeleteOrder` (which clears RESTRICT children first). `bulkHardDeleteOrders` + red **Delete** button on the OrdersTab bulk bar (typed DELETE prompt); LeadsView delete simplified (no archive pre-step) + typed confirm. Outgoing payments are kept (FK SET NULL) — ledger survives deletes.

## Sprint PB-2d — Permit batch 3: 8 more cemetery blanks (2026-07-22, commit ca62833)

Templates now total **45**. New (all mapped visually from Paul's zip `drive-download-20260721T211919Z`): Fairview Westfield (Vargas signature erased from the blank, sketch on back), Holy Cross **North Arlington** 2-page (dims/sketch + Newark-archdiocese authorization), St. Joseph Keyport, St. Mary of Ostrabrama monument application (9 request checkboxes) + VA-Marker form (check-one $300/$600), St. Mary's **Clark** 2-page (authorization + dims/sketch — binds the Clark row `5a4fa706`, NOT the Perth Amboy dupes), St. Vladimir Jackson foundation order (foundation W×D from base autofill, sketch bottom-half front), Washington Monumental South River (grave-section diagram checkboxes).

- **New cemetery row:** `St. Mary of Ostrabrama Cemetery` (South River) `4cc276de-1e9a-4b2a-8811-bd6b120954d3` — didn't exist; both Ostrabrama templates bind to it.
- **Fixed a mis-bind:** the older "Holy Cross - Diocese of Metuchen Work Permit" was bound to Holy Cross **North Arlington** (Newark archdiocese — wrong diocese). Unbound (cemetery_id NULL, note appended). OPEN: needs its real cemetery row (Metuchen-diocese Holy Cross, likely South Brunswick/Jamesburg) — ask Paul.
- Blanks in `public/permit-forms/{fairview-westfield, holycross-northarlington, stjoseph-keyport, ostrabrama-monument, ostrabrama-vamarker, stmarys-clark, stvlad, washington-monumental}/`.
- **`work_batch_jobs`** — link table (many jobs → one batch). `stop_order` sequences field-trip stops (NULL on shop blocks); self-FK `carry_over_from` tracks a stop slipping from one day's batch to another. `ON DELETE CASCADE` from both `work_batches` and `jobs`.
- **`job_promises`** — per-job, per-team-member promise log. `kept` is NULL while open, true if completed on/before `promised_date`, false if late. Drives the 🤡 treatment everywhere and the rolling per-team kept-rate counters.
- **`bulk_orders`** — a single supplier PO grouping milestones (kinds: `stone` / `photo` / `etching` / `bronze`). Milestones link via `job_milestones.bulk_order_id` (`ON DELETE SET NULL`); `supplier_eta` feeds the date-projection engine instead of the generic 30-day pacing default.
- **`cemeteries` geocoding columns** — `geocoded_lat`, `geocoded_lng`, `region_tag`, `geocoded_at`. Feed haversine distance math for the trip optimizer / dispatch mileage. Populated by the one-shot `scripts/geocode_cemeteries.mjs` (Nominatim, 1 req/sec).
- **`job_milestones` date-projection columns** — `contract_due_at` (customer-facing promise; never auto-moves), `projected_completion_at` (system's honest live estimate; persisted only on operator override), `projected_completion_at_user_set` (sticky-override flag — projection must not overwrite when true), `bulk_order_id` (link above).
- **RLS** — all three scheduler tables (`work_batches`, `work_batch_jobs`, `job_promises`) get RLS enabled + a single `authenticated`-only full-CRUD policy each (`*_authenticated_all`, `using/with check (true)`). No anon access — staff-internal posture. Without this, authenticated writes fail with *"new row violates row-level security policy."*

### Migration files (all ✅ APPLIED to production 2026-05-26/27 — idempotent, safe to re-run)

- `supabase/migrations/20260526_date_projection_and_bulk_orders.sql` — `bulk_orders` table + the four `job_milestones` projection/link columns.
- `supabase/migrations/20260526_scheduler_substrate.sql` — `work_batches`, `work_batch_jobs`, `job_promises` + the four `cemeteries` geocoding columns.
- `supabase/migrations/20260527_custom_event_batch_kinds.sql` — extends `work_batches_kind_check` with `site_visit` + `errand` (nine → eleven kinds).
- `supabase/migrations/20260527_scheduler_rls.sql` — RLS enable + `authenticated`-all policies on the three scheduler tables.

## Sprint SCHED-UI — Scheduler UI: discoverability + custom events + weather + polish

**The UI layer that sits on top of Sprint SCHED.** One commit (`808457e`) — five operator gaps closed in one focused pass. New files `src/components/SearchBar.jsx`, `AddEventModal.jsx`, `AddPromiseModal.jsx`, `components/calendar/WeatherStrip.jsx`, `lib/weather.js`; touches `SchedulerTab.jsx`, `CalendarTab.jsx`, `TodayTab.jsx` / `TodayRow.jsx`, `JobsTab.jsx`, `JobsQueueRow.jsx`, the calendar/scheduler subcomponents, and `lib/stonebooksData.js`. **Carries migration `20260527_custom_event_batch_kinds.sql`** (also listed under Sprint SCHED — `site_visit` + `errand` kinds, ✅ applied to prod 2026-05-27).

- **Global search** (`SearchBar`) on the Jobs and Scheduler tabs — fuzzy-matches surname + cemetery name + order number across customers, jobs, and orders; click a result to jump to that entity. Repurposes the existing entity-index substrate.
- **Promise discoverability** — three new entry points beyond the existing JobDetail strip: a **"+ Add promise"** button on the Scheduler page (search-first flow — find the job, then promise it, via the shared `AddPromiseModal`), plus quick-add affordances on **Today rows** and **Jobs queue rows** that open the modal with the job pre-filled. The JobDetail `PromiseStrip` is reworked — clearer "Promise tracker" eyebrow, more prominent button, now powered by the same `AddPromiseModal`.
- **Custom calendar events** — `work_batches` can now carry **zero jobs** and serve as ad-hoc entries via the two new kinds (`site_visit` = cemetery look / customer meeting; `errand` = pick up parts, drop off paperwork). Surfaced through a **"+ Add event"** button on the Calendar tab (`AddEventModal`). Zero-job batches render cleanly (no empty stops list).
- **Weather** (`lib/weather.js` + `WeatherStrip`) — weather.gov / NWS forecast in Calendar **Day** view (full line below the date header) and **Week** view (compact per-day pill next to each day header). **Free, no API key, no ongoing cost**; cached in memory for the session; **silent failure** if NWS is unreachable — never blocks the UI. Adverse conditions (snow / storm / heavy rain / freezing) trigger an **amber tint** so the operator sees the warning.
- **Visual polish** — Scheduler Month date number bumped with a stronger "today" treatment; promise-cell icon + surname enlarged; batch-card / dispatch stop-name / dispatch-spec sizing nudged up so the **dispatch sheet reads as a printable document**; Calendar Week day headers gain a drag-handle glyph so the swap-day affordance is discoverable.
- **🤡 remains the only emoji in the app.**

## Sprint CAL-DRAG — Drag-to-calendar v1 + promise color engine

**Promise-anchored scheduling on the Calendar Week view.** Commit `14bba26`. New files `src/lib/promiseDayState.js`, `src/components/calendar/UndoToast.jsx`; touches `src/CalendarTab.jsx`, `src/components/calendar/CalendarWeek.jsx`, `src/components/calendar/CalendarBatchCard.jsx`, `src/lib/stonebooksData.js`. **Carries migration `20260527_work_batches_am_pm.sql`** — adds a nullable `am_pm` text column with CHECK `am_pm IS NULL OR am_pm IN ('am','pm')`. **Column verified present in prod via PostgREST on 2026-05-27** (`?select=am_pm` → 200); the CHECK constraint isn't introspectable with the anon key (RLS blocks row reads too), so the constraint is asserted from the migration, not independently re-verified. Native HTML5 drag throughout — **no new dependencies**.

### Drag-to-calendar v1
- **Unscheduled tray on Calendar Week** — a horizontal strip above the day grid lists every unscheduled batch (`scheduled_date IS NULL`, excludes cancelled). The Calendar Week is now the dispatcher's single screen: tray on top, calendar below.
- **Batch cards + tray chips are draggable** — `CalendarBatchCard` gains `draggable` / `onDragStart` / `onDragEnd`; dataTransfer payload `{ batchId, fromDate, fromSlot }`. Click-to-drill preserved.
- **AM / PM / all-day drop zones** — each day column splits into an all-day band + AM zone + PM zone; scheduled batches render in their zone by `am_pm`. Drop → `updateBatch(batchId, { scheduled_date, am_pm })` → existing `onReload`.
- **Undo toast** — after a successful drop, an **8-second** toast with a **shrinking progress-bar countdown** offers Undo (restores the previous `{ scheduled_date, am_pm }`); only the most recent toast shows; red error variant for failed saves.
- **Day-swap preserved** — the existing day-header drag-to-swap (`swapBatchDays`) and Day-view stop-reorder are untouched. Header drag (`dragSrcISO`, no dataTransfer) and batch drag (dataTransfer + `draggingBatch`) are disambiguated in the zone handlers so they never collide.

### Promise color engine (`promiseDayState.js` — pure, unit-testable)
`computePromiseDayState(day, promises, batches, batchJobs[, todayISO])` colors each Week day as a **historical performance record**, reading BOTH open and resolved promises on that day. Five states, worst-wins (`missed > red > amber > green`):
- **red** — open, future, no scheduled batch (unprotected)
- **amber** — open, a batch is scheduled (in progress)
- **green** — `kept = true` (PERMANENT positive mark — does not disappear)
- **missed-permanent** — `kept = false` (PERMANENT broken-promise mark)
- **missed-transitional** — `kept IS NULL` and `promised_date < today` (will be auto-marked false later)

"Protected" counts **scheduled batches only** (`scheduled_date NULL` / tray excluded) and **excludes `cancelled` batches**. The Calendar loads promises via `getAllOpenPromises({ includeResolved: true })` so settled promises still paint; the card-level 🤡 (`promisesByJob`) stays open-only. Missed-red days are **click-through** to Day view.

### Auto-resolve (system-computed, not human-marked)
- **`resolvePromisesForJob(jobId)`** — wired into `markBatchJobComplete` (fires only on an operator's dispatch-completion action). When all the job's **scheduled** stops are complete, sets `kept` (true if latest completion ≤ `promised_date`, else false) **and** `resolved_at`.
- **`expirePastPromises(today)`** — defined but **intentionally uncalled** (no mount-time sweep). The dev server points at prod, so an auto-sweep would mutate the live demo; it gets a manual trigger (button / dev script) next sprint. Until then, past-due open promises render as missed-transitional via the date check.

### am_pm data layer
`20260527_work_batches_am_pm.sql` applied to prod (column verified present via PostgREST 2026-05-27, see the migration note above); `am_pm` wired into `createBatch` (insert payload) and `updateBatch` (patch whitelist). `getBatches` already `select('*')`, so reads include it with no change.

### Reviewer-agent pre-commit pass (8 fixes)
A multi-lens review (UX / code / operational) drove 8 fixes before commit: (1) monotonic request token on `loadAll` so overlapping reloads can't clobber state with stale rows; (2) `onDragEnd` on the day header clears `dragSrcISO` (abandoned-swap drag leak); (3) try/catch + error toast on `handleScheduleBatch` / `handleUndo` / `confirmSwap`; (4) cancelled batches no longer count as promise "protection"; (5) drop-zone feedback while dragging (`--drag-active` on all zones, `--drag-over` on the hovered zone via `onDragEnter`/`onDragLeave`); (6) "drop here" hint renders only mid-drag; (7) undo window 5s → 8s with a visible countdown bar; (8) missed-red day is tappable → drills to Day view.

### Demo data
4 demo jobs unbatched and parked at mapped, actionable milestones so the Scheduler workflow columns populate: **DEMO-018 + DEMO-023 → setting** (`ready_to_install`), **DEMO-021 → foundation_trip** (`foundation_poured`), **DEMO-013 → blasting** (`production_started`). Their `work_batch_jobs` links were removed from `demo_seed_scheduler.sql` (now ~36 links); milestone states set in `demo_seed_25_jobs.sql` STEP 6.5. Prod brought current via a delta block, not a full re-seed.

## Parked for next sprint (CAL-DRAG follow-ups)

- **Scheduler workflow-grid is structurally incomplete — the next operational sprint.** `getSchedulableJobs` maps only **4** milestone keys to columns: `stencil_cut` → inscription (inscription job_type only), `foundation_poured` → foundation_trip, `production_started` → blasting, `ready_to_install` → setting (or delivery for non-`new_stone`). **4 batch kinds have NO milestone mapping** and can never populate from job state today: `acid_wash`, `repair`, `rub_grab`, `door_trip`. The grid can't fully run the shop until every kind has a ready-signal.
- **Deferred from the reviewer pass:**
  - **Drag affordance on cards** — batch cards look identical to plain clickable buttons; add a grip glyph / hover cue (the gesture is currently undiscoverable).
  - **Promise color-wash redesign** — full-column tint collides with card-level amber (running-late) / red (promise) backgrounds, and missed-vs-red read too similarly; needs a design call (likely a top accent bar + neutral body).
  - **Per-crew lanes / per-person load** — dispatch is by truck (Lonnie / Mike); the day has no per-crew lane or load count.
  - **Cemetery + section + tap-to-call on the card** — scheduling needs address/section/phone without drilling three screens deep.
  - **Readiness blocking** — nothing stops scheduling a setting whose stone isn't carved or whose foundation isn't poured; flag or block by job stage.
  - **`resolvePromisesForJob` TOCTOU** — simultaneous stop completions can read link state mid-commit and leave a promise unresolved or double-written; the manual `expirePastPromises` sweep is the backstop.

## Lifecycle gaps to triage (CAL-DRAG follow-up)

- **Stale tray batch lifecycle** — a batch sitting unscheduled (`scheduled_date NULL`) for weeks has no nag / decay / auto-archive behavior; the tray can accumulate forever.
- **Cemetery deletion behavior** — `work_batches.destination_cemetery_id` is `RESTRICT`, so deleting a cemetery that's in use is correctly blocked, but the operator gets no clear explanation of *why* the delete failed.
- **Concurrent drop within the 8s undo window** — two dispatchers (or one operator in two tabs) dropping the same batch on different days is last-write-wins with no conflict surface; the undo toast reflects only the local action.
- **Cancelled job inside a scheduled batch** — undefined behavior when one of a batch's jobs is cancelled: the stop should disappear but the batch should survive. Needs a defined rule + UI.
- **DST / timezone edge cases** — date math uses ISO date strings (`YYYY-MM-DD`) so it *should* be timezone-safe, but unverified at DST boundaries / month edges.

## Sprint WORKFLOW-COMPLETE — Cemetery door orders end-to-end

**Door work becomes a first-class order type — the original workflow-completeness goal.** New file `src/CemeteryOrderWizard.jsx`; touches `src/Stonebooks.jsx` (order-type chooser) and `src/lib/stonebooksData.js` (cemetery-order data layer + door pricing). Seven migrations (A, B, D, E, F, G, H — all ✅ applied to prod 2026-05-27).

- **Separate order type.** "+ New sale" now opens a **Family sale vs Cemetery order** chooser (`OrderTypeChooser` in `Stonebooks.jsx`). Family routes into the **unchanged** `SalesMode` wizard; Cemetery routes into the new `CemeteryOrderWizard`. Resuming an existing family order skips the chooser.
- **`cemetery_orders` table** (Migration F) — door orders live here, separate from family-sales `orders`; the cemetery is the customer. One PO per order; `doors` jsonb holds per-door spec. Jobs link via `jobs.cemetery_order_id` (mutually exclusive with `order_id`, enforced by `jobs_order_or_cemetery_order`); `order_id` made nullable and the old `UNIQUE(order_id)` dropped (Migration E) so one order spawns N jobs.
- **6-step `CemeteryOrderWizard`** (desktop-optimized, bronze/near-black, Inter): (1) cemetery picker — 4 known cards + "Add another" custom seeded from the Clover Leaf list (snapshotted onto the row); (2) door count; (3) doors editor — **sticky left rail** (door list + running total) + right-pane editor; (4) packet upload (Supabase Storage `cemetery_packets`); (5) contact (auto-populated phone); (6) review — **inline per-line price overrides** + sticky **dark totals card** with **NJ sales-tax (6.625%)** and **credit-card-fee (3%)** toggles. Debounced autosave; printable PO via `window.print()`.
- **Pricing** — `CEMETERY_DOOR_PRICING` (St James indoor/outdoor split; Beth Israel / Woodbridge Memorial Gardens / Clover Leaf flat) + `lookupCemeteryPricing` / `getDoorPrice` (override-aware) / `getCemeteryPricingForOrder` (snapshot-aware). Migration H adds `cemetery_pricing_snapshot`, `tax_applied`, `cc_fee_applied`.
- **Submit → production** (`createJobsFromCemeteryOrder`) spawns **one `mausoleum_door` job per door** (each stamped `door_index`, idempotent per `(cemetery_order_id, door_index)`), seeds each job's **17-milestone** workflow, flips the order to `in_production`, snapshots `total_amount` (incl. tax/CC toggles), assigns `CO-{YYYY}-{NNN}`.
- **`mausoleum_door` template** (Migration B) — 17 milestones (contract → deposit → cemetery_confirmed → door_pickup → proof → stencil → production → door_dropoff → install → closeout), using the **standard team vocabulary** `admin / installation / production / sales` (matches `job_milestones_team_check`).
- **Contact auto-populate** — `getCemeteryByName` token-matches the order's cemetery label to a `cemeteries` row (suffix-aware: strips cemetery/memorial/park/gardens/mausoleum/parish), prefilling `contact_phone`; name + email are typed per order.
- **`service_kind`** (Migration A) — discriminates acid_wash vs repair on cleaning_repair jobs (REPAIR-wins). `MAUSOLEUM_DOOR` service code retained in `SERVICE_TYPES`/`SERVICE_TIMELINES` (the door flow routes off the chooser, not that code).
- **First real cemetery order created end-to-end during dev:** `CO-2026-001` — Beth Israel, 2 doors, $411 (2 × $205.50 inscription), 2 jobs × 17 milestones.

### Migrations (all ✅ applied to prod 2026-05-27)
- `20260527_cleaning_repair_service_kind.sql` (A) — `jobs.service_kind`
- `20260527_mausoleum_door_job_type.sql` (B) — mausoleum_door template (17 milestones; corrected `admin/installation/production/sales` teams)
- `20260527_jobs_door_index.sql` (D) — `jobs.door_index`
- `20260527_drop_jobs_order_id_unique.sql` (E) — drop `UNIQUE(order_id)` for multi-job-per-order
- `20260527_cemetery_orders.sql` (F) — `cemetery_orders` + `jobs.cemetery_order_id` + XOR check
- `20260527_drop_orders_mausoleum_door_intake.sql` (G) — drop the orphaned `orders.mausoleum_door_intake`
- `20260527_cemetery_orders_overrides_and_toggles.sql` (H) — `cemetery_pricing_snapshot`, `tax_applied`, `cc_fee_applied`
- *(Migration C, `orders.mausoleum_door_intake`, was added mid-sprint for an earlier door model, then reverted — its column is dropped by G.)*

## Parked for next sprint (WORKFLOW-COMPLETE follow-ups)

- **`cemeteries.contact_email` is null on every row** — populate when known; the wizard's email field auto-fills once data exists.
- **No "list cemetery orders / resume draft" surface** — the wizard creates `cemetery_orders` drafts but nothing lists or reopens them; a draft is only reachable while the wizard is open. Needs a list/resume view.
- **Per-cemetery rate cards are a hardcoded JS constant** (`CEMETERY_DOOR_PRICING`) — migrate to a DB table once 3+ custom cemeteries exist.
- **Scheduler workflow-grid still incomplete for non-batch job_types** (carried from CAL-DRAG) — only 4 milestone keys map to columns; `acid_wash` / `repair` / `rub_grab` / `door_trip` coverage pending.

## Phase 4 backlog (SCHEDULER-COMPLETE follow-ups)

Locked items for the next scheduler sprint. All are deferred from SCHEDULER-COMPLETE Phases 2+3 by explicit decision; the cascade infrastructure landed without these so the sprint could close clean.

- **Foundation flow done right.** Template migration adding a `foundation_cured` milestone + downstream gating: setting/install work must not surface as schedulable until `foundation_cured` flips (7-day cure window after pour). Re-enable foundation_trip routing with source=`foundation_scheduled` (or whatever pre-pour key is correct), completion=`foundation_poured`, and a separate `foundation_cured` flip by timer or manual operator action. Until this lands, foundation work is NOT schedulable through the workbench — by design (Monument Ops review: setting on green concrete is a physical-product-damage hazard).
- **Door milestone rename.** Template migration: `door_installed` → `door_returned` (or `door_dropped_off`). Shevchenko Monuments does NOT install mausoleum doors — the "dropoff" leg is the crew returning the door to the cemetery. The current `door_installed` key is a MISNOMER held in place by the template. UI text already says "returned" / "dropped off" everywhere user-facing this sprint; the raw key stays internal until this migration.
- **inscription_completed proper milestone.** Replace the (K) source-as-completion fallback (which today cascades `stencil_cut` to done at dispatch tick) with a real `inscription_completed` template milestone. Phase 3 audit confirmed nothing currently keys off `inscription_completed` — once it exists, wire it up.
- **Dispatch acknowledgment + override flow with audit trail.** The full T1 treatment of the cascade-failure notice that was deferred this sprint: red row tint on affected stops, modal/blocking banner at top of dispatch sheet ("3 stops need review — [Review now] / [Dispatch anyway]"), explicit override button with reason capture, and an audit log row per override. Phase 3 shipped the loud-but-not-modal version: top-of-sheet count badge + inline amber notice.
- **Delivery route re-enable.** The non-new_stone `ready_to_install` branch is commented out (P) until a real non-new_stone template carries `ready_to_install`. Reinstate explicitly when that template lands AND the cascade target is verified present in that template.
- **acid_wash / repair / rub_grab routing.** Template-content decisions: what milestone key triggers each? Monument Ops proposed `acid_wash_needed`/`acid_wash_completed`, `repair_needed`/`repair_completed`, `rub_grab_needed`/`rub_grab_completed` (the latter should gate `stencil_cut` for matching-inscription jobs).
- **Export-layer milestone display-name mapping.** When/if any export (CSV, PDF, email to outside parties) surfaces raw milestone keys, add a humanizing display map so `door_installed` reads as "Door returned to cemetery," `production_completed` reads as "Production completed," etc. Phase 3 audit confirmed NO current customer-facing surface exposes raw milestone keys; this is forward-cover for any future export feature.
- **(T8) Foundation-stage read-only awareness badge.** Stones waiting on foundation cure should remain visible on Job rows / Today / Profit surfaces with a "Waiting on foundation cure" badge even if not schedulable — operator's mental map must not lose them.
- **(T9) Weather + cemetery-hours gating.** Surface a weather flag on the dispatch day; respect cemetery access hours and sexton-only windows when surfacing batchable work.
- **(T10) Two-stone / one-cemetery batching sanity check.** Verify on a real day's data that the source-key re-surface guard works per-trip not per-job — same truck shouldn't get routed to the same cemetery twice in a week when it could have been one stop.
- **Phase 5 follow-ups (scheduler dead-surface UX):**
  - Lift BatchBuilder mount from WeekWorkbench to SchedulerTab so Month CTA can open the modal directly without the Month→Week zoom-switch intermediate. CRM + Production reviews flagged the two-transition jump on Month CTA → "Build a batch" as adding "where am I now?" confusion. UX agent said current behavior is fine; defer to a structural refactor sprint.
  - Kind-aware tray-aging thresholds: today the threshold is a flat 14 days. Production's "right fix" is per-kind thresholds derived from a "waiting on" tag captured at build time (cure / supplier ETA / approval / crew / other), each with its own age band — `cure` flags at 8d, `crew` at 3d, `supplier_eta` at 21d. Requires a small data-model addition (the tag itself).
  - Customer-name search to add a stop to a Quick / ad-hoc batch. Today the Trip Suggestions panel is cemetery-keyed only; an ad-hoc batch with no destination has no way to add a stop other than via column-tick. Real shop need (Production review): "Mrs. K just called, find her order — add to today's batch."
  - Per-crew lane / per-person view on the workbench. Today the columns are kind-keyed; a real shop dispatcher needs to see Lonnie's truck day vs Mike's truck day side-by-side. (Already parked under CAL-DRAG follow-ups; re-flagged here.)
  - Readiness gate on Quick Batch save: when kind is operational (not site_visit/errand) and stops.length === 0, the disabled save button is the soft blocker. Production flagged that a louder forcing message would catch the "tried to use Quick Batch for setting" mistake earlier. Phase 6 candidate.

## Operational-truth follow-ups (CRM-RESKIN-PASS backlog)

Items deferred from the 2026-05-28 Customers + Orders rebuild. All flagged by agent reviews (CRM Practicality, UX Friction, Workflow Intelligence, Monument Ops) — kept here so the data + UX layer surfaces them when their dependencies land.

- **Cemetery-order linking via `cemetery_order_id`** — crypt-door jobs that route through `cemetery_orders` (not `orders`) are joined to jobs via `j.cemetery_order_id`, not `j.order_id`. Today's CustomersTab + OrdersTab build their job lookup map by `order_id` only, so crypt-door jobs return null pressure (no milestone-based blocker, only overdue_balance fires). Extend the lookup once a cemetery_order surface needs the same blocker treatment.
- **Companion stones edge case** — one order with two deceased vs. two orders for the same family. Today's primary-order picker assumes 1 customer → 1 primary stone; companion pairs (Mary & Robert Walsh on one stone, OR two side-by-side stones ordered together) need either a "pair" indicator on the row or a side-by-side rendering. Real shop need per Monument review.
- **"Awaiting granite" / supplier-ETA blocker** — Paul cannot promise an install date without knowing when the raw stone arrives. Requires a supplier-order substrate (similar to bulk_orders but for blocks). Add as a 6th-priority amber blocker (between proof and cemetery_hold) once data lands.
- **"Door in shop — Xd" indicator** for crypt-door jobs — Shevchenko holds the family's door during inscription/restoration. That's both a liability and a clock. Bolts onto the SCHEDULER-COMPLETE cascade (door_picked_up milestone has a status_date — read it). Render as a small bronze pill on the row.
- **Forward-looking target-date age column** — replace "Xd since signed" with "Target: Aug 14 (in 18d)" once `target_completion_date` populates reliably. Monument: "forward-looking beats backward-looking on a working dashboard."
- **Photo thumbnails on row** — proof image, in-progress shot, final install photo. Bolts onto a future photo-evidence sprint (storage + render pipeline). Real shop need: "monument shops live and die by visual records."
- **Mobile card-view list pages** — today the ≤900px breakpoint falls back to a single-column stack with a "Best viewed on desktop" advisory banner. Phase 6 candidate: build a real 2-column label-value card layout for mobile.
- **"Cemetery hold" → sub-kinds** — split into "Awaiting cemetery permit" / "Awaiting plot info" / "Awaiting cemetery rules check" when template milestones disambiguate. Each maps to a different phone call.
- **Multi-blocker `+N` indicator** — small superscript count on the blocker chip when an order has additional blockers below the highest-severity one. CRM agent recommended; deferred until operators ask for it (single-chip principle holds for now).
- **"Stuck in production" duration fallback** — when `production_started.status_date` is null (currently ~97% of milestones), the stall computation falls back to `order.signed_at` per the inline comment in `computeOrderPressure`. Note in code; once status_date populates reliably (post-cascade), the fallback becomes irrelevant. Don't remove the fallback prematurely.

### JOBS-RESKIN-PASS additions (2026-05-28)

- **CRM-DETAIL-RESKIN-PASS sprint** — JobDetail / CustomerDetail / OrderDetail still on the legacy `.sb-page` / `.sb-page-head` design system. Clicking into a row from any reskinned list view drops the operator into the old visual identity (UX + Monument reviews both flagged the whiplash). Reskin the three detail surfaces in a dedicated sprint before the visual debt compounds further.
- **Promise badge on Jobs row** — `getActivePromisesForJob` already exists; surface as a small inline pill on the Jobs row when an open promise exists for that job. Highest-stakes operational signal a shop can carry. No new schema; data is here.
- **Last-update authorship eyebrow** — Jobs row's "Updated" column shows `last_update_at` (when) but not who. In a 5-person shop, "Mike updated, 3d ago" answers a different question than just "3d ago." Needs a `last_update_by` column on jobs OR a join through `job_events` to find the latest event author.
- **"Signed orders without jobs" red blocker surface in OrdersTab** — replaces the dropped BackfillBanner (which lived on JobsTab and was retired in JOBS-RESKIN-PASS). The recovery path (createJobFromOrder) still exists in the data layer; just needs to land as a new blocker kind in `computeOrderPressure` so it surfaces as a red chip in Orders rows. CRM agent's #2 finding.
- **Production foreman saved view / alt-sort** — surfaces stalled `production_started` jobs at the top so Paul can do the "shop floor walk" reading ("what's parked in the shop"). Default action-priority sort is right for the owner-inbox read; a saved view for the foreman read is the alternate.
- **This-week's logistics view** — install schedule + pickup/delivery for the week. Monument review: "logistics is a real daily question for a 5-person shop with one truck." Lives outside the Jobs list as its own surface (probably a Calendar tab subview).
- **Age column visual escalation for aged crypt-door rows** — crypt-door jobs show empty Blocker (no order = no pressure, by design until cemetery_order_id linking lands). To prevent Paul's eye from skimming past aged crypt-door rows that are silently stuck in the shop, escalate the Age column visually (e.g., amber tint at 30d+, red at 60d+) when blocker is empty AND age is high. Monument review #3.
- **Backfill recovery surfacing from Orders** — JOBS-RESKIN-PASS dropped BackfillBanner because Jobs tab was being rebuilt; the recovery flow (signed orders without jobs) should re-emerge as a red blocker on the OrdersTab. Same backlog item as the "Signed orders without jobs red blocker" above — listed twice deliberately because they're two halves of the same fix.
- **Orders vs Jobs merge (open architectural question)** — Paul is weighing whether to merge the standalone Orders tab INTO the Jobs tab as a unified work-item surface. The Orders DB stays; the standalone tab might collapse. If that merge proceeds, the Jobs row needs additional columns (contract total, balance, full payment progress at order grain) which the JOBS-RESKIN-PASS deliberately didn't add (those live on Orders today). Hold the Jobs commit until Paul resolves this question — re-touching the file next sprint vs adding the columns now is the tradeoff.

### JOBS-OPERATIONAL-HUBS Phase 1B priorities (2026-05-29)

Backlog from the Phase 1A ship (`01208c7`). The 4-hub surface (Admin / Design / Production / Installation) is live, family-first row pattern preserved, Hubs/All toggle persists per-user. Substrate (`HUB_DEFS`, `getHubWorkItems`, `ROLE_GROUP_MAP +5`) is in place. Items 1-3 came from Workflow Intel; 4-5 are the explicitly-deferred hubs; 6-10 are CRM + UX Friction polish; 11-12 are open-decision items the reviewers raised and Paul shipped as-documented.

1. **`cemetery_deadline` → Admin Hub** *(Workflow Intel HIGH)* — single-field read on `orders.cemetery_deadline`. Path: extend `HUB_DEFS.admin` with an `actionItemKinds` set + a second pass in `getHubWorkItems` over `getActionItems` output. Or wire as a 10th `computeOrderPressure` blocker. Hard external deadline that admin staff need to see today, not after the next sprint.
2. **`stalled_job` → Production Hub** *(Workflow Intel HIGH)* — jobs silent ≥14d with no actionable milestone in scope. Today's `production_blocked` requires `production_started=done` + `production_completed` actionable; jobs that fall outside that pattern but are operationally stuck are invisible. Same integration path as #1.
3. **`waiting_aged` → Admin Hub** — 7d+ waiting nag. Complements the immediate-fire `waiting_on_family` blocker. Same integration path as #1 + #2.
4. **Sales Hub** — orders-driven (not jobs-driven). Substrate already loads orders alongside jobs in `JobsDepartmentView`. Needs a new `HUB_DEFS.sales` entry, an orders-based item shape, lead/quote/contract-pending columns. The `getEstimatesNeedingFollowup` helper already exists.
5. **Owner aggregator** — `OwnerAttentionListView`, `OwnerStack`, `getAllAmberTasks`, `getAllOverdueTasks` all survive untouched in `src/components/` + `src/lib/stonebooksData.js`. Ready to revive as a 5th tab on the hub strip or as a separate view mode (Hubs / Owner roll-up / All).
6. **JobsViewToggle placement unification** — currently inconsistent (header-actions in Hubs mode, floating above in All mode). UX Friction flagged 🟡; pick one position both modes share.
7. **Hub-active visual signal strengthening** — CRM lens called the bronze left-rule "barely sufficient" for operators returning from another tab. Options: hub-name banner above the chip row, stronger background contrast, or active-hub eyebrow on the page header.
8. **Filter chip noise pruning** — `Closeout` / `Intake gap` / `Stone` were flagged as niche-not-daily by CRM. Move behind a "Show more filters" disclosure, or split each hub's chip set into "primary" + "advanced."
9. **Sort tie-break within Installation blue band** — `stone_ready_schedule_trip` should outrank `install_scheduled` (operator priority: unscheduled work > scheduled work). Pure `computeOrderPressure` change, no hub-level surgery.
10. **Mobile single-column fallback** — the `.sb-crm-min-width-banner` honestly says "Best viewed on desktop"; the promised single-column fallback isn't built yet. Earn the contract.
11. **Closeout split (admin paperwork vs field `completion_photo_uploaded`)** — Phase 2 candidate if operationally bites. Phase 1A shipped with the rationale documented in `HUB_DEFS.admin.milestoneGroups` ("admin verifies paperwork side; field crew takes the photo"). If office staff start complaining about closeout items they don't own, split the group.
12. **`proof_waiting_customer` routing** — keep in Design Hub unless the office-chase pattern proves wrong. Phase 1A shipped with the rationale documented in `HUB_DEFS.design.blockerKinds` ("work physically stalls in design even when admin makes the chase call"). Move to Admin if the chase-call ownership shifts in practice.

### DEMO-GARBAGE-PURGE follow-up sprint (queued for after DEMO-DATA-CLEANUP lands)

Hygiene items that surfaced during the 2026-05-28 DEMO-DATA-CLEANUP rename pass. All are DELETE / disambiguation work, not rename — distinct scope from the rename sprint.

- **10 "Paul Vargas" manual-test customers** — all created 2026-05-08 in rapid succession (`first_name='Paul', last_name='Vargas', city='Fort Johnson South', state='NJ'`), from manual UI walks. Not real customer data, not demo-seed data either — third bucket. Should be DELETEd. Check for any linked orders/jobs first (likely none, but verify).
- **18 archived/draft `E-26-0001` through `E-26-0018` orders** — manual UI test orders from early dev. Most are `archived`; 5 are `draft`. One has `primary_lastname='asdfasdf'` and status `paid_in_full` (smoke test). Same DELETE story as the Paul Vargas customers. Watch out: the demo-seed rename moved the DEMO orders into `E-26-0019` through `E-26-0043`, so this purge is about the FIRST 18 only.
- **Fairview Cemetery name collision** — two real cemetery rows share the name `Fairview Cemetery` (one in Westfield NJ, one in Staten Island NY, both seeded 2026-05-08). Surfaced by Phase C Tx3 GATE 2 duplicate-name check (not from the rename — pre-existing collision). Apply the same disambiguation pattern used for the demo cemetery renames: rename to `Fairview Cemetery — Westfield` / `Fairview Cemetery — Staten Island`. Trivial UPDATE.

## Sprint VENDOR-PORTAL — Vendor / Partner Portal V1 (+ app-wide privacy lockdown)

A B2B work-tracker: outside companies (engravers, setters, design shops) submit work to Shevchenko and track it to pickup; staff run it all from an internal Vendors tab. Built in phases; then the whole app was made private. Commits `953e9e8` (P1) → `feac331` (P2) → `79b5861` (P3) → `953d6d8` (partner lockdown) → `f9aefbb`/`194e14f` (anon lockdown + private app) → staff-signal + this doc.

### Data model (Phase 1 — `supabase/migrations/20260608_vendor_portal.sql`)
9 tables, private storage bucket:
- **`partners`** — the outside company (name, contact, phone, email, address, payment_terms, active).
- **`partner_users`** — maps a Supabase Auth user → exactly one partner (`unique(auth_user_id)`, role `'partner'`). This is the **sole** staff/partner discriminator: a user IS a partner iff they have a row here; STAFF = authenticated user with NO row here. No separate staff table.
- **`vendor_requests`** — parent request. `source` ∈ `'partner'|'internal'` discriminates the two creation paths. Carries **quote placeholders only** (`quote_required`, `quote_status`, `quote_approved_by_owner`, `quote_id`, `owner_review_status`) — DATA ONLY, no quote UI this build.
- **`vendor_items`** — the line items (editable). 8-state status enum: `submitted → waiting_on_info → ready_to_work → in_progress → design_uploaded → ready_for_pickup → completed` (+ `cancelled`). work_type ∈ `design|blasting|setting|other`.
- **`vendor_batches`** — optional grouping of items.
- **`vendor_pos` / `vendor_po_items`** — simple POs, **no pricing logic** (custom amount only), draft/sent.
- **`vendor_attachments`** — files per request OR item; `uploader_role` ∈ `partner|staff`, `kind` ∈ `upload|completion_photo`. Stored in the private **`vendor-files`** bucket under `<partner_id>/...` (signed-URL downloads, never public).
- **`vendor_events`** — timeline (`submitted|status_changed|file_uploaded|info_requested|email_sent|completed`; `note` added in P3 for comments).
- All 9 get RLS + an authenticated-all policy in P1 so the **internal tab ships first**; partner-scoping comes in P3.

### Both creation paths converge (key invariant)
`createVendorRequest(input)` in `src/lib/vendorsData.js` is the **single shared path**. Internal staff (`source:'internal'`, NewRequestModal in `VendorsTab.jsx`) and external partners (`source:'partner'`, NewRequestForm in `PartnerPortal.jsx`) produce **identical** `vendor_requests` + `vendor_items` rows and both land in the same internal Work Queue. The shared item card is `src/components/VendorItemCard.jsx` (work-type tiles, vendor ref, stone/base size, color datalist, drag-drop attachments, **prominent work-type-specific notes box**, optional cemetery/family). Files stage in memory (`_files`) and upload after the item has an id.

### Internal Vendors tab (Phase 2 — `src/VendorsTab.jsx`)
Sidebar nav `Vendors`. Sub-nav **Work Queue | Batches | Partners | POs**. Work Queue = all items across partners (partner/type/status filters) → item drawer (full edit, status, files in 3 groups, photos, request-info email, Ready/Completed, add-to-batch, generate PO, duplicate/remove/+item/edit-parent, timeline). Partners CRUD (this is where a partner is set up before a portal invite). Batches (create/add/remove/status/PO). POs (from item or batch, draft/send, PDF via jsPDF **CDN loader** — jsPDF is NOT an npm dep). Partner-facing emails route through a **reviewable composer** (reuses `sendOrderEmail` with `orderId:null`) — never silently auto-send the meaningful ones.

### External partner portal (Phase 3 — `src/PartnerPortal.jsx`, `supabase/migrations/20260609_vendor_portal_rls.sql`)
- **Routing:** `getMyPartnerContext()` resolves the signed-in user → partner or null. `Stonebooks.jsx` renders `<PartnerPortal>` for a partner-mapped user instead of the staff app; the entity-index warm-up is gated to staff so partner sessions don't pull CRM data.
- **Portal surfaces:** Home (stats + active work), New Request (shared path), Open Jobs / Ready for Pickup / Completed (cards → read-only detail drawer), POs (view-only). Detail drawer: view fields/notes, download Shevchenko files + completion photos (signed URLs), upload additional files, comment, timeline. **Partners cannot change status or edit submitted line items** — submit / view / upload-additional / comment only.
- **Partner-scoped RLS (multi-tenant isolation):** `vp_my_partner_id()` / `vp_owns_request()` / `vp_owns_item()` / `vp_owns_po()` SECURITY DEFINER helpers. Replaces the P1 broad policies on all 9 tables with STAFF full-CRUD (`vp_my_partner_id() IS NULL`) + PARTNER scoped (own `partner_id` rows only, via direct column or request/item/po join). Storage scoped to the partner's `<partner_id>/` prefix. **One partner can never see another's data** — verification checklist at the bottom of the migration.
- **Invite flow (`supabase/functions/vendor-invite/index.ts`):** staff open a partner → Portal access → enter the contact email → the Edge Function (service role, rejects partner callers) `inviteUserByEmail` so the **partner sets their own password** from the email (staff never type partner credentials), then upserts the `partner_users` mapping. `invitePartnerUser()` in vendorsData calls it.

### App-wide privacy lockdown (the anon key ships in the frontend = public)
Two sequential RLS passes — **apply in order, verify each before the next** (I cannot run prod SQL from here; each migration ships a discovery query + a verification block + a one-file rollback in `supabase/backups/`):
- **PASS 1 — partner lockdown (`20260610_partner_lockdown.sql`, rollback `2026-06-04_partner_lockdown_rollback.sql`).** `is_staff()` = authenticated AND not in `partner_users`. Adds a **RESTRICTIVE** `to authenticated using(is_staff())` policy to every non-vendor table (AND-combines → genuinely excludes partners; staff + anon untouched; non-destructive/reversible). RLS-off core tables (orders/customers/jobs/…, likely created via dashboard with RLS off) get RLS enabled + an anon-preserve + staff permissive; original state logged in `_vp_rls_lockdown_log` for exact rollback. Also `storage.objects` (partners narrowed to `vendor-files`). Net: **partners blocked from all non-vendor tables.**
- **PASS 2 — anon lockdown / private app (`20260611_anon_lockdown.sql`, rollback `2026-06-04_anon_lockdown_rollback.sql`).** Anon allowlist is **EMPTY** — the catalog is no longer public. Adds RESTRICTIVE `to anon using(false)` to every table (monuments included) and drops the PASS-1 anon-preserve grants. Net: **the public anon key has ZERO access to any table.** App side: `src/App.jsx` `CustomerApp` resolves auth first and shows `CatalogLoginGate` (branded staff sign-in) to unauthenticated visitors instead of an empty page; the monuments load is gated on auth. Consequence: the public anon SalesMode order-creation path is closed along with the catalog; staff workflows (authenticated) are unaffected.

Three-role end state (verify in Studio): **anon** → 0 on everything; **staff** → full catalog + CRM unchanged (`is_staff()=true`); **partner** → vendor data only.

### Staff notification on partner submit (closing the last gap)
`getNewPartnerRequestCount()` (vendorsData) = distinct partner-source requests with ≥1 `'submitted'` item — honest + schema-free (rises on partner submit, falls as staff advance items off `submitted`). Surfaced as a **bronze badge on the `Vendors` sidebar nav item** (refreshes on tab change + every 60s, staff-only) so a submit is visible **without opening the tab**; reinforced inside the Work Queue with a count badge on the sub-nav, an "N new partner requests awaiting triage" banner with a Show-only toggle, `NEW` row pills, and new-first sort. Staff email on submit is **available** via the existing reviewable composer but intentionally **not auto-sent** (avoids noise / Gmail-dependency); the in-app signal satisfies the acceptance.

### Migrations to run in Studio (in order) + deploy
1. `20260608_vendor_portal.sql` — tables + bucket.
2. `20260609_vendor_portal_rls.sql` — partner-scoped RLS (run the isolation checklist).
3. `20260610_partner_lockdown.sql` — block partners from non-vendor tables (run STEP-0 discovery + STEP-5 verify; staff must keep full access).
4. `20260611_anon_lockdown.sql` — private app (run STEP-0 + three-role verify). Re-runnable.
5. **Deploy the Edge Function:** `supabase functions deploy vendor-invite` (else the invite button reports it's unavailable; everything else works).
Each pass has a matching rollback in `supabase/backups/` for instant revert.

### NOT in V1 (parked)
Quotes tab / pricing / billing / vendor price lists / QuickBooks / vendor performance reports. Quote fields are data-only placeholders. Also parked: a "resume partner draft" list, kind-aware batch routing for vendor work, and surfacing the new-request signal on the Today action-item list (the sidebar badge already covers cross-tab visibility).

## Deferred / known issues

- **Mausoleum range on calendar/customer-list/receipt** — those surfaces show only `targetCompletionDate` (the range start); the `targetCompletionEndDate` is not yet surfaced there. Future sprint if needed.
- **Two-color companion stones** — not supported; single `graniteColor` per order drives due-date math. Would need a data-model change.
- **Sprint 3t (remote contract signing)** — Vercel auto-deploy is now wired and healthy (every push to `main` builds a Production deploy; last verified `b8f08bc`, 2026-05-27), so the original "deploys not wired" blocker is cleared. The remaining open question is whether `VITE_APP_MODE`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` are set in the prod Vercel project — **unverified as of 2026-05-27** (build success doesn't confirm env vars). If unset, prod renders the public catalog instead of the staff wizard; confirm those vars before relying on 3t.

## Feature backlog after 3p

1. Zelle integration
2. ~~Sign step restructure (preview first, then signature)~~ — ✅ SHIPPED in Sprint 3v
3. Hand Sculpted quote-request flow
4. Remote contract signing
5. **Split Flat Markers into Grass / Hickey / Bronze** — today the Flat Markers tab in the Design step covers all three because the monument catalog has only a single generic `flat` tag (no grass/hickey/bronze sub-tags exist in the data at all). Requires a from-scratch catalog retag of all 141 flat-marker entries before the tabs can be split — not just a rename, an actual sub-classification pass.
6. **Sprint 3w — Target Completion Date field on the Pricing step.** Auto-populates from the same calculation as the contract's Estimated Due Date (`calculateDueDate`). Staff can override the value before the contract publishes. The contract PDF then reads from this stored value instead of recalculating at PDF-generation time — so a staff override sticks and the date is locked in at publish time rather than drifting.

## Git / GitHub

- GitHub repo: https://github.com/pvvargas12-eng/stonebooks (private)
- Branch: `main`
- First commit on 2026-05-11 captured the project at end of Sprint 3o
