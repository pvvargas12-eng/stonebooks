# Stonebooks audit — 2026-07-14

Scope: prod data integrity (via Management API) + two code sweeps (status/milestone consistency across surfaces; money paths + UI dead ends) at HEAD `7ff0044`. Findings ranked. No fixes applied — detection only.

## CRITICAL — money / phantom data

### A1. 46 permit checks ($51,431.80) missing from the outgoing-payments ledger  [DATA]
Every one carries a check number that appears **nowhere** in `outgoing_payments` (verified by reference alone, ignoring order links). They exist only in `orders.permit[]`, so Payments › Outgoing and every paid-out total understate permit spend by ~$51k. A further ~27 filings have no check number and can't be verified either way (some may also be missing). The 20260612 permit→outgoing backfill either never ran or covered a subset. The sync seam (`createPermitOutgoingPayment`, dedup via `source_permit_key`) already exists — a backfill run + skip report is the fix.
Also caught in passing: **ck 2857 ($1,549)** is claimed by both E-26-0003 (in ledger) and E-26-0004 BRAND (filing only) — duplicate entry or one check covering two permits; human call. **PARISER E-26-0027** permit filed date says **2028**-03-19 (typo). **E-26-0144 PACKARD** filing has no date (backfill will skip by design — needs hand entry).

### A2. Quick "Add a Customer Payment" still records checks with no check number  [CODE]
`OrderDetail.jsx` `savePaymentQuick` (Financial card ⋯ quick-add, ~line 1166) calls `recordOrderPayment` with no `missingCheckRef` guard; drafts default to method=check and land **locked** with `ref: null`. Every other surface got the guard on 2026-07-14; this one was missed.

### A3. Status edits on LEAD orders create phantom "active" jobs on every work surface  [CODE]
`ensureJobForStatus` / `ensureJobId` (OrdersTab ~805, OrderDetail ~512) auto-create a job via `createJobFromOrder({allowUnsigned:true})` for ANY jobless order — including drafts/leads with no deposit and no signature. `getJobs` filters archived but not draft/lead, so the un-contracted lead instantly appears as live work in the Jobs tab, Production/Installation hubs, field crew screens, and the scheduler pool. Needs a gate (e.g. only auto-create for contracted/deposit-bearing orders, or exclude lead-status orders from work surfaces).

### A4. Wizard service-type flip-flop permanently wipes production progress  [CODE]
`syncJobToOrderType` runs on every wizard autosave and only no-ops when the FINAL type is unchanged. Multi-toggling Step-1 service types passes through intermediate derived types → full milestone DELETE+reinsert per toggle; design/stone/production statuses are outside the carry set, so toggling away and back leaves the same job_type with its production ladder reset. Also: a job already in an open work_batch keeps its batch link while its readiness resets under it.

## HIGH — surfaces disagreeing / master-override leaks

### B1. Production hub lies about bronze + inscription jobs  [CODE — hubConfigs.js]
- `statusFor`/`blockingFor` never call `statusDimApplies`: inscription/door jobs show amber "Stone not ordered" + a blocker for stone they'll never order (Orders table correctly shows "—" for the same order).
- Hardcoded `proof_approved` in the blocker check → bronze jobs show "Layout not approved — stencil/cut blocked" forever, even after `bronze_proof_approved` is done.
- Hub `in_prod` chip set omits `received` → a received bronze is in no chip.

### B2. Field Production screen mis-buckets  [CODE — field/ProductionScreen.jsx]
"To order" filter catches every inscription/cleaning job (they derive `not_ordered`); received bronzes match no filter chip at all (visible only under "All"). Field JobDetail also renders Stone/FDN ladders on inscription jobs where they don't apply (taps no-op harmlessly).

### B3. Monument die/base panel can knock a received bronze back to un-ordered  [CODE — OrderDetail stoneToSimple ~99]
`stoneToSimple('received')` falls through to `'ordered'`; the simplified panel can then write `not_ordered`, clearing `bronze_ordered`+`bronze_received`. Narrow but silent data loss.

### B4. Pipeline rail's drop-off collapse can hide OUR dig/pour ladder  [CODE — orderPipeline.js cemeteryHandlesFoundation]
The milestone-shape branch (`foundation_scheduled` done, dig/pour/in not) fires without checking `foundation_type`, so any order passing through that mid-state shows "Foundation — cemetery pours it" and hides our Dig/Pour/In rungs until `foundation_dug` flips. Should require `foundation_type === 'Cemetery Foundation'` or an explicit signal.

### B5. removePermitFee orphan risks  [CODE — OrderDetail ~1010]
Deletes the ledger row first; the `orders.permit[]` filing rewrite is conditional on a key match that does NOT `Number()`-normalize amounts in the primary path (jsonb `"110.0"` vs form `110` → mismatch → filing survives, ledger row gone → Permit Hub still shows it as filed). `setOrderPermit` errors are also ignored.

## MEDIUM — data hygiene (prod)

- **2 signed orders with no job:** E-26-0278 Czajka (contracted), E-26-0393 EGAN (paid_in_full). Invisible to Jobs/production until someone touches a status (which now auto-creates — see A3 gate before relying on that).
- **11 locked check payments with no check number** (pre-guard legacy): E-26-0061 Carpenter Sr. ×3 ($200/$400/$400), E-26-0213 Moise $2,694, E-26-0241 DELARATO $595, E-26-0248 Medina $2,552, E-26-0276 PAPPACHRISTUS $695, E-26-0279 Shvartsman $3,500, E-26-0289 MINSAL $2,000, E-26-0338 Rubinstein $1,000, E-26-0412 Moskowitz $1,772. Editing any of them now demands the number (guard), so they'll heal on touch — or fix in one pass from the checkbook.
- **Blank family names** on E-26-0060, E-26-0070, E-26-0168 (null/empty `primary_lastname` AND missing/blank deceased surname).
- **FoundationsBoard + JobsTab fetch `getJobs({limit:1000})`** while OrdersTab uses 2000 — silent truncation as job count approaches 1000; the foundations pool would drop jobs with no indicator.

## LOW / cosmetic

- CSV report exports round money to whole dollars (`lib/reportDefs.jsx` 206/239/277/307/339) — contradicts the never-round rule; exports won't tie to on-screen cents.
- Sorting the Orders table by Design/Stone/FDN ranks em-dash (N/A) rows by their hidden derived value — confusing interleave.
- Production queues (`PRODUCTION_QUEUES`/`classifyOrderQueues`) are new_stone-only by design — bronze/inscription work never enters QueuesTab (pre-existing, compounds B1/B2).
- DesignHubHome's status boxes don't offer inscription's `Cut` (coverage gap, not a defect).

## Verified clean

fmtUSD cents change (no consumer double-formats; PDF generators have their own 2-decimal formatters) · wizard payment drafts can't lock without the check guard · all other payment surfaces guarded · tone/label maps handle `cut`/`received` · `not_needed` consistent across rail counts and % complete · retemplate leaves proof_versions intact and doesn't duplicate derived milestones · no stale-cache dead end after job auto-create · Orders view-switch pagination + cancelled-status scope pills correct · field Stone ladder + FoundationsBoard writers vocabulary-correct.
