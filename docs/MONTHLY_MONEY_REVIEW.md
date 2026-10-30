# The monthly money review — how it runs (2026-10-30)

Paul: "I want this to be a monthly thing where every single report is uploaded and I get an analysis. I want to see growth."

The page is **Reports › Monthly review** in Stonebooks. It has three parts:

1. **Growth, month by month** — cash in (every family payment, from `orders.payments[]`), cash out (every line in the Accounting book, filed or in the inbox), net, the fixed nut, sales signed, each against the month before, with a bar chart. Click a month to see where its money went. This block is live: it reads the same rows the Accounting tab and Owner stats read, so nothing is typed twice.
2. **Statements in the cabinet** — one row per account, one column per month, so a missing statement is visible before anyone asks. The account list is `STATEMENT_ACCOUNTS` in `src/lib/ownerReviews.js`; edit it when an account opens or closes.
3. **Owner reviews** — the written analysis per period (`owner_reviews`): score out of 10, headline, the analysis and game plan, the full report. The score trend sits above the cards.

## The monthly routine (first week of the month, about an hour)

1. **Download the statements** for the month that just closed — every account on the Statements block — into the Banking folder, one sub-folder per month (`2026 Banking/2026-11/`). Bank statements close at month end; the cards close mid-month, so a card statement belongs to the month its closing date falls in.
2. **Upload them** in Accounting › Statements & documents. Label each one with the account's last four and the month (for example `Chase Ink 8051 - closing Nov 19 2026`), so the cabinet grid fills in. Or let the load script do it (step 3 handles both).
3. **Load the lines.** Ask Claude: "run the monthly money review for November 2026". Claude runs the parser and classifier that live beside the statements in the Banking folder's `_audit-scripts/` (their README has the exact commands), matches every check and card charge against `outgoing_payments` so nothing is counted twice, loads the unmatched lines into the Accounting inbox as `source = statement` with a proposed category, and uploads the PDFs to the cabinet if step 2 was skipped.
4. **Confirm the inbox.** Accounting › Inbox, filter STATEMENT, sort the "who was paid?" checks and anything flagged, then Confirm all shown. Every check with no Stonebooks row gets named here. This is the part only the office can do.
5. **The analysis.** Claude writes the review for the month against the previous months (the growth table), scores it honestly, and saves it on the page with the full report attached. Paul reads it, edits the words if he disagrees, and the game plan becomes the Friday meeting's money page.

## What the score means

The score is a judgement, not a formula, but it is anchored on five things in this order: net cash for the period, the fixed nut as a share of cash in, how much of what is owed to the shop is over 60 days old, whether every dollar out has a name, and whether the previous period's game plan was done. A 4 is "busy and sold, not yet profitable". A 7 is "the nut is covered by collected money with room to spare and the receivables are current".

## Guard rails

- Figures stay out of this repository. The report HTML and the ledger live in the Banking folder and in the private `receipts` bucket (`docs/reviews/...`), and the written review lives in the `owner_reviews` table.
- Nothing in the review writes to orders, payments or balances. The page is read-only on the money truths; the only writes are the review rows themselves.
- The inbox load is idempotent on the statement line's key, so re-running a month never doubles a line.
