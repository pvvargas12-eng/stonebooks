# Stonebooks CRM — Shevchenko Monuments

Staff-facing CRM for Shevchenko Monuments (Perth Amboy, NJ, est. 1919).
React + Supabase. Internal use only.

## Operational locks

- Shevchenko tenant UUID: `a1b2c3d4-e5f6-7890-abcd-ef0123456789` (default for every new `tenant_id` column)
- NJ sales tax: 6.625%
- Sprint naming convention: `3o → 3p → 3q → 3r → 3r.2 → 3s → 3s.3 → 3u → 3v → 3w`
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
- Hosting: Vercel (old `shevchenko-catalog.vercel.app` is stale; new deploys not yet wired)
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

## Deferred / known issues

- **Mausoleum due-date math** — shows "TBD — contact office" until the 6–8 month range-picker UI is built (deferred from 3u).
- **Two-color companion stones** — not supported; single `graniteColor` per order drives due-date math. Would need a data-model change.
- **Sprint 3t (remote contract signing)** is parked pending the Vercel env-var fix — `VITE_APP_MODE`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` need to be set in the `stonebooks-beta` Vercel project for prod to render the staff wizard instead of the public catalog.

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
