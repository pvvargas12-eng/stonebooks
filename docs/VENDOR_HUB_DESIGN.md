# Vendor Hub — Design Plan (DRAFT — not built)

Status: **design only.** No tables, routes, or UI in this document's scope. This
mirrors the existing **Cemetery Orders** subsystem (`cemetery_orders` + the
`CemeteryOrderWizard` / `CemeteryOrdersTab` / `CemeteryOrderDetail` trio), but
for **dealer / wholesale** relationships instead of cemeteries-as-customer.

## Purpose

Shevchenko does subcontracted work **for other monument dealers** — blasting,
design/layout, inscriptions, repairs, photo/etching — and also **buys** some of
the same from outside vendors. The Vendor Hub is the operational home for those
B2B jobs: who the vendor is, what they ordered (or what we ordered from them),
where each job sits in production, and the money owed/paid on the wholesale rate
card (distinct from retail family pricing).

Architectural stance: **mirror `cemetery_orders`, don't fork the family `orders`
table.** Cemetery orders already proved the pattern — a separate order table
whose "customer" is an organization, one PO per order, line-item spec in JSONB,
jobs linked by a dedicated FK, its own wizard + tab + detail. Vendor orders are
the same shape with a different counterparty.

---

## 1. Vendors List

A directory of dealer/wholesale counterparties (the B2B analog of `cemeteries`).

- **Table:** `vendors` — `id, tenant_id, name, contact_name, contact_phone,
  contact_email, address_*, billing_terms (net30/COD/…), wholesale_notes,
  default_rate_card jsonb, archived, archived_at, created_at, updated_at`.
- **Direction flag** per vendor or per order: are they a **customer** (we do
  work for them) or a **supplier** (we buy from them)? Some are both — model
  the direction on the *order*, not the vendor (see §2).
- Reuse the `cemeteries` UI conventions: searchable list (ilike `%term%`,
  per the recent search fix), add/edit inline, archive (soft) + delete
  (RESTRICT-guarded), a requirements/terms editor like the Cemetery
  requirements panel.

## 2. Vendor Orders

The PO unit (mirror of `cemetery_orders`).

- **Table:** `vendor_orders` — `id, tenant_id, vendor_id (FK vendors),
  order_number (VO-YYYY-NNN), direction ('outbound' = we do work for them /
  'inbound' = we buy from them), items jsonb (per-line spec), status,
  total_amount, rate_card_snapshot jsonb, tax_applied, fee_applied, notes,
  archived, archived_at, submitted_at, created_at, updated_at`.
- **One PO per order**, `items[]` holds the per-line spec (job type + size +
  qty + wholesale price), exactly as `cemetery_orders.doors[]` does.
- **Number scheme:** `VO-2026-001` (generator mirrors
  `generateCemeteryOrderNumber`).
- **Pricing:** a wholesale rate card per vendor (`vendors.default_rate_card`),
  snapshotted onto the order at submit (`rate_card_snapshot`) — same
  snapshot-on-submit discipline as `cemetery_pricing_snapshot`.

## 3. Vendor Job Types

What the line items can be. Outbound (we perform): **blasting, design/layout,
inscription, repair, photo, etching, cleaning/restoration.** Inbound (we
purchase): **raw stone, bronze, finished components, etching/photo
subcontract.**

- Implementation: a `vendor_order_item.job_type` enum + a milestone template
  per type (mirror the `milestone_templates` rows for `mausoleum_door`). On
  submit, spawn one job per item via `jobs.vendor_order_id` (new nullable FK,
  mutually exclusive with `order_id` / `cemetery_order_id` — extend the existing
  XOR check). Each job seeds its type's milestone workflow.
- Reuse the shared status dimensions where they map (Design / Stone / FDN are
  family-specific; vendor work mostly uses Design + a generic production ladder).

## 4. Workflow Statuses

Order-level (mirror `cemetery_orders.status` CHECK): `draft → submitted →
in_production → completed → invoiced → paid` (+ `cancelled`). Add a B2B-specific
`awaiting_vendor` for inbound POs we're waiting on.

Per-job production status comes from the milestone template (the same engine
Jobs/Scheduler already read), so vendor jobs flow through the **same hubs and
the same set-gate** as everything else — no parallel status logic.

## 5. Hub Views

A `VendorHub` surface modeled on the Permit/Cemetery surfaces:
- **Dashboard cards:** open POs · in production · awaiting vendor · overdue ·
  unpaid (A/R for outbound, A/P for inbound).
- **Worklist table:** one row per vendor order — vendor · # · direction ·
  items · status · balance · updated. Click → detail.
- **By-vendor rollup** (like the cemetery rollup): outstanding balance + job
  count per vendor.
- Lives under the existing Jobs hub strip as a **section hub** ("Vendors"),
  consistent with how Workflow + Permits were folded in — OR as its own
  top-level tab if volume warrants. Decide at build time from expected volume.

## 6. Vendor Order Detail Page

Mirror `CemeteryOrderDetail`:
- Header: vendor name, VO#, direction, status pill, balance.
- Line items with per-line spec + wholesale price (inline price overrides like
  the cemetery review step).
- Linked jobs (per item) with their production stage + blocker (shared gate).
- Money block: total, payments/receipts, balance; tax/fee toggles.
- Actions: edit, archive, delete (RESTRICT-guarded), print PO (`window.print`),
  record payment/receipt.
- Attachments: vendor packets / proofs (reuse the attachments pattern).

## 7. Future Integrations

- **QuickBooks bridge** — outbound POs → invoices (A/R), inbound POs → bills
  (A/P). The dormant `qb_*` columns + the QB import loader already establish the
  mapping convention.
- **Vendor portal** — a read-only status link per PO (the remote-signing infra
  could extend here).
- **Rate-card automation** — per-vendor price lists move from a JS constant to a
  `vendor_rate_cards` table once 3+ vendors exist (same trajectory noted for
  `CEMETERY_DOOR_PRICING`).
- **Profit integration** — vendor outbound revenue + inbound costs feed the
  Profit tab via the same `pays`/cost rollup the family + cemetery orders use.

---

## Migrations this WILL require (when built — not now)

1. `vendors` table (+ RLS authenticated-all, tenant default).
2. `vendor_orders` table (+ status CHECK, RLS).
3. `jobs.vendor_order_id` FK + extend the order/cemetery_order XOR check to a
   three-way exclusivity.
4. `milestone_templates` rows for the new vendor job types.
5. `vendor_order_id` columns on `financial_records` / `job_cost_estimates` for
   profit attribution.

All are DB/RLS/tenant changes → require explicit confirmation + Studio runs per
the project's migration discipline. **None are in scope for this draft.**
