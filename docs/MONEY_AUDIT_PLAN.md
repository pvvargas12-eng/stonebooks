# Where the money goes — the plan (2026-10-30)

Paul, 2026-10-30: "I am getting all my bank statements from the past 4 months. I want a 100% audit and an understanding of where my money is: how much is paid on the mortgage, insurance, payroll, vendors on stone supplies, bronzes, and random things like food, gas. We MUST get a hold of this or we will lose everything. Many of our vendors bill us on email — Matthews, Peerless, Coldspring, Glenrock, EW Granite, Wenzco, Peppin and Kani, Phoenix Memorial, Isaac and Sinal (etcher). We must see our margins: how much every order cost me on granite, stencil, supplies, time."

Three pieces, in the order they pay off. The first one starts the moment the statements land.

## What Stonebooks already has (the ground to build on)

- **Accounting tab (ACCT-1, 2026-09-01):** `acct_expenses` (rule-based category proposals, Paul confirms — nothing auto-categorizes), `acct_documents` + the private `receipts` bucket (Statements & documents section already takes uploads), the Schedule C engine and Tax center, the phone Receipt screen.
- **Money in:** `orders.payments[]` is the truth for every dollar a family paid (Owner stats › Cash in reads it as of OWNER-NUMBERS-1).
- **Money out we already track:** `outgoing_payments` (permit fees, cemetery fees, the odd vendor check), the Permit Log.
- **Vendor mail:** the synced shevcoteam inbox reaches back to 2020 (52k messages). Vendor invoices are in there as attachments; bodies are kept 6 months, attachments re-hydrate from Gmail on click.
- **Vendor cost signals per order:** stone PRs (`bulk_orders` lines, Peerless / Kani price books with cost per stone), bronze orders (Matthews plate + backer prices), `orders.stone_vendor`.
- **Field › Financials:** Collected / Spent / Net by month for the owner's phone.

## Piece 1 — The four-month audit (starts when the statements arrive)

**What I need from Paul**
1. Bank statements for the last four months as PDF or CSV — every account the shop's money moves through: business checking, savings, any card (business AND any personal card that pays shop bills), the loan / mortgage statements, the payroll provider's reports for the same months.
2. Drop them in one folder (a `statements/` folder on the desktop, or upload each in Accounting › Statements & documents). Nothing gets read until it is there.
3. One line each on: who the payroll provider is, the list of loans / mortgage / lines of credit (lender + monthly payment), the insurance policies (carrier + what it covers).

**What I do (read-only until Paul says otherwise)**
1. Parse every statement line (date, description, amount, direction, account). No line is skipped; the count of lines in equals the count of lines out, reconciled to each statement's opening and closing balance so nothing is lost.
2. Put every line in one of Paul's buckets: **Mortgage / rent**, **Insurance**, **Payroll** (gross + taxes + provider fee), **Stone suppliers** (Peerless, Coldspring, Kani, Glenrock, EW Granite, Wenzco), **Bronze** (Matthews), **Outside work** (Isaac & Sinal, Peppin, Phoenix Memorial), **Permits & cemetery fees**, **Fuel**, **Food**, **Shop supplies & tools**, **Loans & debt service**, **Bank & card fees**, **Transfers between own accounts** (never counted twice), **Owner draws**, **Unknown**. The same rule engine as the Accounting inbox proposes; Paul confirms. The Unknown pile is the list he names.
3. Deliver the **"Where the money went"** report — by month and bucket: cash in (families, from Stonebooks) vs cash out, net; the fixed monthly nut (mortgage + insurance + payroll + loans = what the shop must clear before a single stone is paid for); debt service as a share of cash in; vendor spend as a share of sales; the random-spend line (food, fuel, card) on its own so it can be seen; the top 20 payees by dollars; anything paid twice.
4. Land the confirmed lines in `acct_expenses` (statement line = source, account + statement date on the row) so the Tax center, Field › Financials and the report read the same rows. Receipts attach to them as they are found.

**Then it keeps itself:** statement-vs-book reconcile (the yard-count pattern for dollars: on the statement with no receipt / receipt that never hit the bank), a monthly "nut vs cash in" tile on Owner stats, and the same report every month without the hand work.

## Piece 2 — Vendor bills from email (accounts payable)

- **New table `vendor_bills`:** vendor, invoice number, invoice date, due date, amount, what it is for (order numbers / PR number when the bill names them), status unpaid / paid / disputed / credit, the `messages.id` it came from, the attachment path, paid_on + the bank line it matched.
- **The sweep (same shape as the website-leads sweep):** every N minutes, new mail from the known billing senders (Matthews, Peerless, Coldspring, Glenrock, EW Granite, Wenzco, Peppin & Kani, Phoenix Memorial, Isaac & Sinal — their domains collected from the inbox on day one, editable in Settings) → the PDF attachment is read → invoice number, date, total, line items proposed → a draft bill in **Accounting › Bills** (AI proposes, Paul or the office confirms; a bill is never "real" until confirmed — the Reconcile doctrine).
- **The views:** what we owe by vendor and age (current / 30 / 60 / 90+), the next 30 days of due bills, paid history per vendor; a bill matched to its bank line closes itself. The PR acknowledgement already on file (PR-ACK) is the natural match for a stone bill: PR → ack → bill → payment, one chain per stone order.
- **Backfill:** the four months of vendor mail already in the inbox get swept first, so Piece 1's vendor bucket and Piece 2's bills agree.

## Piece 3 — Margins per order

- **`job_costs`:** one row per cost on an order — kind (granite, bronze, outside work / etching, stencil & supplies, permit & cemetery fees, labor time, delivery), amount, source (vendor bill line / PR line / outgoing payment / time entry / allocation), evidence link. Rows come from Piece 2's bills (a bill line naming an order lands on it), the PRs (a received stone's cost at the book price), the permit fees already in `outgoing_payments`, and labor from the floor: the phone already stamps who advanced each piece and when, and the install trips carry crew — a time entry per blast / cut / set is a small add.
- **Allocation for the rest:** stencil, blast media, consumables and shop overhead spread per stone from Piece 1's monthly totals (overhead per stone = fixed nut / stones completed that month) so an order's margin is honest, not just its direct costs.
- **Where it shows:** the order page (contract, costs by kind, gross margin $ and %), Owner stats (margin by job type and by month, the orders under water), the Quote Generator (cost + markup is already there for stone; this closes the loop with what it really cost).

## Build order

1. Piece 1 the day the statements are in the folder (the report first, the rows second).
2. Piece 2's sweep + Bills inbox (one new table, one cron, one view).
3. Piece 3 on top of 1 + 2 (costs flow in from bills and PRs; labor time is the one new capture on the phone).
