# Stonebooks CRM — Shevchenko Monuments

Staff-facing CRM for Shevchenko Monuments (Perth Amboy, NJ, est. 1919).
React + Supabase. Internal use only.

## Operational locks

- Shevchenko tenant UUID: `a1b2c3d4-e5f6-7890-abcd-ef0123456789` (default for every new `tenant_id` column)
- NJ sales tax: 6.625%
- Sprint naming convention: `3o → 3p → 3q → 3r → 3r.2 → 3s → 3s.3 → 3u → 3v → 3w → 3x → S1 → M2-P1 → M2-P2 → M2-P2.1 → M2-P3 → M2-P4 (M2 COMPLETE) → L2-P1 → L2-P2 → L2-P3 → L2-P4 (L2 COMPLETE) → OWNER-CARDS → SCHED → SCHED-UI → CAL-DRAG`
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

## Stack

- Frontend: React (Vite), single-page app
- Backend: Supabase (Postgres + Auth + Storage)
- Hosting: Vercel — auto-deploy is wired and healthy; every push to `main` triggers a Production build (last verified deploy `b8f08bc`, 2026-05-27). The old `shevchenko-catalog.vercel.app` URL is stale; current deploys publish under the `stonebooks-*.vercel.app` project.
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
