# Stonebooks audit — November 10, 2026

Two read-only passes over the whole app: one hunting glitches (things that are wrong today), one hunting places to improve (things that cost the office time or let two screens disagree). Nothing in the database was changed by the audit. Every glitch listed as fixed was re-read in the code before the fix; the two checked against live data say so.

## Part 1 — Glitches fixed in this round

| # | What was wrong | What you would have seen | Fix |
|---|---|---|---|
| 1 | A contract date set by hand (Sales row or the order page) was saved as midnight with no time zone. | "Contract signed" read one day early, and the sale counted in the week or month before on Owner stats. **186 of your 440 signed orders carry this** (checked in the live data). | New dates save at noon local. The 186 old rows are NOT changed yet — see "Your call" below. |
| 2 | The Sales table never loaded the permit filed / approved dates. | Picking Submitted or Approved on a Sales row re-stamped the date with today, even when the permit was filed weeks ago. | The two dates are loaded now, so the first date sticks. |
| 3 | Editing a yard stone on the desktop sent its status along even when you did not change it. | Fixing the zone or crate on a MISSING or PROBLEM stone wiped the family and order it belonged to. | An unchanged status stays out of the save. |
| 4 | Cancel order / Restore in the sales wizard saved the order only. | A cancelled order's job stayed on Jobs, the cut list and the bring-up pool. | Cancel closes the job; Restore reopens it. |
| 5 | Accounting › Add expense › Attach to read fields jobs do not have. | Every job read "Job 5b8130c3" and every order a dash. | Family name and order number. |
| 6 | Two places still used "paid more than $0" as the test for a real order. | An old order made real with a $0.00 payment was left out of the Team Meeting, and got a "Deposit needed" email task. | Both use the one rule (signed + a payment record). |
| 7 | The Cemetery Orders paid total counted voided payments. | A voided payment still showed as paid on the list. | Voids are skipped, same as the order page and the invoice. |
| 8 | Phone › More › Full desktop › Profit pointed at a tab that no longer exists. | It landed on Today. | Points at Accounting. Reconcile's description fixed too. |
| 9 | All 23 doors from your four submitted cemetery orders sat in a hidden queue. | Mausoleum Doors on the Production floor showed zero. | Fixed by the cemetery-order lines built this round. |

## Part 2 — Glitches found, NOT fixed (ranked)

1. **Three customer emails send in one click with no preview.** The receipt "Email" button in the sales wizard, the contract signing-link email, and the automatic email to a dealer when a trade order is accepted or a rush is approved. Your rule is that every customer send shows the exact email first. These need the same confirm screen the Zelle receipt and the balance request already use. Size: one session.
2. **A failed load looks like "no data".** If Payments cannot read the orders it shows $0 outstanding and an empty Collect balances list with no message. Sales, the Production floor, Today and Reports behave the same way, and a failed Sales read is remembered for 60 seconds. They need a "could not load, retry" strip. Size: one session, starting with Payments and Sales.
3. **Lists that stop at 500 rows.** Permit Builder, Today's signals, the top search and the Design hub read the newest 500 orders or jobs. With 578 live orders, "Make permit" on an older order can answer "Could not find that order". Size: small each.
4. **The 1,000-row ceiling.** Several screens ask for 2,000 to 6,000 rows but the database hands back 1,000 at a time. Jobs are at about 750, so Sales rows and Owner stats will start losing the oldest jobs soon. The Accounting book may already be past it (one count will tell). Size: small each, same fix everywhere.
5. **Cemetery order wizard ignores a failed save.** A failed autosave silently loses the edit, and a failed save before Submit still creates the door jobs from the old doors and prices. Size: small.
6. **Cemetery order "paid" test does not round to the cent.** Several payments with cents can leave an order reading Partial with $0.00 due. Same bug you had on Friend in October, on the cemetery side. Size: small.
7. **Deletes with no "are you sure".** Calendar "Delete this event" and Vendors "Remove" (an item, sitting between Duplicate and + Item). Size: small.
8. **An order due today reads overdue all day** on the Sales pressure pill, while Today reads it correctly. Size: small.
9. **Jobs › Permits bulk "Set permit status" box has no styling**, so it shows as plain text at the bottom of the list. That hub is retired from the tab strip; fix it or remove it. Size: small.
10. **Smart Matches "Dismiss" still does not save.** The table it needs is not in the live database (checked today). Say "apply" and I will run that migration.

### Your call

- **The 186 contract dates stored a day early.** I can shift them forward to noon the same calendar day they were entered as. It changes the displayed signing date on those orders by one day (to the right one) and moves a few sales between weeks or months on Owner stats. Nothing else reads it. Say the word.

## Part 3 — Areas to improve (the eight that matter most)

1. **"Is the stone here?" is kept in four places that do not update each other.** Submitting a Stone PR ticks the job's "stone ordered" step but does not set the order's Die to Ordered. Receiving a PR adds a yard row but does not mark the order's die or base In stock. So a stone can be ordered and received in Stonebooks and still read "not ordered" on the order until someone flips it by hand. One shared "stone status changed" write would end that. Size: one session.
2. **Receiving a PR does not give the stone a painted number or a zone, and is not on the phone.** A received line lands as one unnumbered row at "Receiving". Tapping "Die is here" on the phone then creates a second row for the same stone. Receive should mint the numbered card and ask zone and crate, on the phone, where the truck is unloaded. Size: one to two sessions.
3. **Cemetery order money is invisible to the money screens.** Cemetery payments live in a separate ledger, so they are missing from Payments, Collect balances, Owner stats and the new Dashboard's Money in. Only Accounting › Profit counts them. Size: one to two sessions.
4. **"Collected" is worked out seven different ways and "Owed" six.** Payments, Owner stats, Monthly review, Profit, Team Meeting and the phone screens each add it up slightly differently (old deposit columns, cancelled orders, unsigned quotes, closed jobs). One money module that every screen calls, with a "how this is counted" line under each tile. Size: one session.
5. **An install can be scheduled in five places.** Scheduler, Calendar, the Install Planner, the set-list card's "Set a date" and the phone each write something different. Decide that the Install Planner week is the one truth, route the rest through it, and turn Calendar into appointments only. Size: a decision first, then a session per screen.
6. **"What do I need to order?" has six answers.** Needs Ordering, the old dashboard tile, Jobs › Admin, the hub chip, the meeting slide and Reconcile each count differently. Make Needs Ordering the one list and have the others show its number. (The new Dashboard's "Stones to order" reads the order's stone status and links to Needs Ordering; it should read the same list once that is done.) Size: one session.
7. **Stone PR lines are typed free text.** "Barre Grey", "Barre Gray", "GREY", "Md Barre" and "IDK" all appear on one PR. The yard match and the book cost built this round read through that, but picks would be exact: Color from the active colors, Type from the yard categories, Size in the three L W H boxes the phone already has. There are also two PR editors (Needs Ordering opens the older one). Size: one session.
8. **A cemetery order never moves past "In production".** Completed, Invoiced and Paid cannot be reached, editing a submitted order does not add or remove door jobs, and door jobs read "Crypt door — TBD" in Jobs and the Install Planner. Roll the order up from its doors and name the doors everywhere. Size: one session.

### The rest, shorter

9. Dead tiles shown to you: Reports "Overdue Work Heatmap" and "Cycle Time by Stage" always say not tracked, Profit "14-day forecast" is a dash, Payments "Connect QuickBooks — soon", Settings "Density — Coming soon", Needs Ordering "Bronze PR — coming soon". Hide them; the bronze PR is the one worth building.
10. Reports › Library "Bottleneck Radar" and "Revenue Stuck in Limbo" read stage labels the Jobs tab no longer trusts. Remove or rebuild on dated events.
11. Money cards that open the wrong list: all four Money pulse tiles open "orders with a balance due", and one Money at Risk slice can only ever be $0.
12. Headline tiles with no click-through: Payments header, Profit top tiles.
13. Job profit is worked out three different ways (Reports, Profit, the job page).
14. Phone Collect balances is look-only: no Contact, no Promise date.
15. Phone Cemetery orders is a list you cannot tap.
16. The phone has two money screens (Money and Payments) and two install screens doing the same job.
17. The Sandblasting vendor board is built but reachable from nowhere. Mount it or delete it.
18. Three separate vendor lists (the order's Vendor pick, PR suppliers, the Vendors tab).
19. A promise-to-pay reminder stays open after the customer pays.
20. The cemetery order wizard has four hard-coded cemeteries; anything else is typed and always gets the Clover Leaf price list. Doors have no crypt number, name or size box.
21. One thing, several names: "Crypt door" / "Mausoleum door" / "Doors"; "Print PO" prints a sheet headed Invoice; "Dashboard" is four different screens; "Reconcile" (data cleanup) next to "Zelle reconcile" (money).
22. Leftovers: Reconcile › Schedule cleanup still matches against a frozen spreadsheet from the summer; Customers has no last contact or lifetime revenue; the desktop order page does not show the GPS grave mark the phone saves.

## What I would do next, in order

1. The three one-click customer emails (your own hard rule).
2. "Could not load" strips on Payments and Sales, and the 500 / 1,000 row limits.
3. One stone-status write (item 1) plus Receive that mints the numbered card (item 2). This is the same trust project as the founding walk.
4. Cemetery order money in Payments and the Dashboard (item 3), with the order status roll-up (item 8).
5. One money module (item 4).
