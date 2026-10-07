# TEAM MEETING + A/B WEEK SYSTEM — build spec (Paul, 2026-10-06)

> Paul's mandate, verbatim essence: run the shop like the Army, very systematically.
> Monday + Friday meetings. A weeks = installations / foundations / inscriptions.
> B weeks = stone production. A new **Team Meeting** tab that converts live
> Stonebooks data into a clean presentation — presentable as a slideshow AND
> scrollable, with every number clickable through to the orders behind it.
> "THIS SHOULD BE VERY VERY VERY EASY SINCE STONEBOOKS TRACKS ALL OF THIS DATA."

He's right: ~90% of this reads straight from stores that already exist. The ONE
new piece of truth the system needs is the **week plan** — a saved snapshot of
what we COMMITTED to, so Friday can honestly compare plan vs. done.

---

## 1. The A/B week operating system

- Weeks alternate: **A week — INSTALL** (installations, foundations, inscriptions)
  and **B week — PRODUCTION** (stencil + blast). All production muscle goes to the
  week's focus; the office preps the OTHER kind of week.
- The calendar anchor: a `week_kind(date)` helper — ISO week number parity with a
  configurable anchor date (Settings → Shop), so Paul can flip which week is A
  without a deploy. Every surface (Team Meeting, Scheduler, Hot List) reads the
  same helper.

### The week lists (the heart of it)
New table **`week_plans`**:
```
week_plans(id, tenant_id, week_start date UNIQUE, kind text check ('install','production'),
           created_by, locked_at, created_at)
week_plan_items(id, plan_id → week_plans CASCADE, job_id → jobs, lane text
           check ('set','foundation','inscription','blast'), sort_order,
           added_by, outcome text null check ('done','missed','dropped'), outcome_note text)
```
- **Building the plan** (office, during the prior week): pickers fed by the
  EXISTING stores — set lane from `install_list` + `installGates`, foundation lane
  from `foundation_list` + `deriveFdnStatus`, inscription lane from active
  inscription jobs, blast lane from `stencil_cut_list` + the floor.
- **Blockers NEVER block adding** (gates inform, never wall): a job goes on the
  list WITH its blockers showing —
  - Set lane: the `installGates` four (paid / permit / foundation / blasted) +
    open balance $ (rowBalanceDue) — "if smith is on install list, stone blasted,
    foundation in, but there's a balance or permit not approved I MUST see that."
  - Blast lane: stone not arrived / not in stock (`deriveStoneStatus`), design
    not approved (`deriveDesignStatus`), **stencil not cut**.
- **Stencil checkoff:** the blast lane shows CUT / NOT CUT per job from the
  `stencil_cut` milestone; the stencil cutter checks it off right on the list
  (writes the milestone — same truth the cut list board uses). Monday the
  production team reads the list and knows exactly what to do.
- **Friday scoring:** each item gets an outcome (done auto-detected from
  milestones where possible — installed/fdn in/inscription_complete/blasted —
  with manual override + a why-not note). Outcomes feed Last Week Review.

---

## 2. The Team Meeting tab

Top-level tab **"Team Meeting"**. Two render modes, one dataset:
- **Present** — full-screen slides, arrow keys / click to advance, clean enough
  to throw on the shop TV. No emojis. Big numbers.
- **Review** — the same slides as a scrollable page; every number is a button
  that expands the order list behind it; clicking an order opens OrderDetail.
- A **PowerPoint export** button (the pptx skill route or print-to-PDF first
  slice) so Paul can keep a copy of every meeting.
- Editable shell: Paul can type into the text areas (verse, comments) and
  hide/reorder slides; the numbers are always live.

### Slide order
1. **Verse of the day** — editable text box, persisted per meeting date.
2. **Last Week Review** — plan vs. reality from `week_plan_items`:
   stones to produce X planned / Y done / Z need fix; set X/Y + why-nots;
   inscriptions X/Y; foundations X/Y. Misses list their outcome notes.
3. **Sales last week** — new orders count, money collected (payments[] dated
   last week), total sale $ (rowGrandTotal of orders signed last week), split
   New stone / Bronze / Insc (OwnerStatsView math, multi-membership).
4. **This Week (A or B)** — the week plan lanes with LOUD blocker chips, each
   blocker naming the fix owner action ("call for balance — $2,732 owed").
   Production weeks add the stencil CUT/NOT CUT tally.
5. **Permits + Foundations** — filed last week (outgoing permit payments,
   the Permit Log source), open orders needing a permit (permitNeeded minus
   submitted/approved), submitted awaiting approval, approved; foundations
   waiting split **cemetery** vs **Shevco** (foundation_type + deriveFdnStatus).
6. **Designs** — approved (bronze + new stone separately), need design, sent
   awaiting approval (the Design Hub buckets), estimate designs needed.
7. **Inventory** — stones / bronzes / photos needing ordering (the
   Needs-Ordering pool: resolveStoneNeeds minus covered), plus open PRs
   awaiting vendor acks.
8. **Admin numbers** — XY line chart, orders per month, one line per type
   (New stone / Bronze / Insc, different colors) — trending up or down;
   overdue orders count; active orders count. (OwnerStats + pressure data.)
9. **Closing** — comments & questions, editable notes box, persisted.

### Round-2 revisions (Paul on the mockup, 2026-10-06)
- **A sheet and B sheet are SEPARATE slides**, both shown every week: the
  focus week's sheet leads (badged "THIS IS THE FOCUS WEEK"); the other sheet
  follows so the cutter works ahead and admin pre-clears blockers.
- **Schedule review slide = a 5-DAY WORK BOARD (round 3):** Mon–Fri columns,
  event cards stacked in day order (install runs gold, digs amber,
  inscriptions green, DELIVERIES blue, meetings grey), blocker chips on the
  card. **DRAG A CARD TO ANOTHER DAY = the adjustment, made live in the
  meeting, writes back to the Scheduler (work_batches scheduled date).**
  An "unscheduled" tray below drags onto days. Open tasks due this week
  listed under the board.
- **Next week preview slide** — the SAME 5-day board for next week:
  which day does what, deliveries (vendor ETAs / PR supplier_eta) and
  inscriptions on their days, same drag-to-adjust.
- **Inputs & needs slide** — free inputs typed live in the meeting ("order
  stencil roll"), saved with the meeting (meeting_notes gains `inputs
  jsonb[]`), each with one-tap TASK IT → addShopTask with an owner.

Suggested extra Last-Week slides (Paul invited suggestions): money collected
vs. same week last month; new leads that didn't sign yet (follow-up list);
closeouts completed; hot-list items cleared.

New table **`meeting_notes`**(meeting_date UNIQUE, verse text, closing_notes
text, slide_prefs jsonb) for the editable shell.

---

## 3. Admin A/B structure (proposal for Paul to approve)

Admin runs the SAME alternation, one week AHEAD of production — admin's job in
any week is to make NEXT week un-blockable:

- **During an A (install) week** admin preps the coming B (production) week:
  - chase design approvals for everything on the candidate blast list
  - order stones / confirm PO acknowledgements (ack must be confirmed)
  - make sure stencils have layouts so the cutter isn't starved
  - pull the blast-week candidate list Wednesday; blockers assigned by Friday
- **During a B (production) week** admin preps the coming A (install) week:
  - collect balances on every set-list candidate (the red "owes $" book)
  - push permits to approved; schedule/dig Shevco foundations; confirm
    cemetery foundations are actually in
  - fill Foundation E-Forms for every dig on the plan
  - call-ahead list for families whose stones will be set
- Daily rhythm: morning — work the blocker list; afternoon — normal flow;
  Thursday EOD — next week's plan DRAFTED in Stonebooks; Friday meeting —
  plan locked (`week_plans.locked_at`).

---

## 4. Build order (when Paul says go)

1. Migration: `week_plans` + `week_plan_items` + `meeting_notes` + week-anchor
   setting. 2. Plan builder UI (lanes + pickers + blockers + stencil checkoff).
3. Team Meeting tab, Review mode first (all slides, live data, click-through).
4. Present mode (full-screen). 5. Outcome scoring + Last Week Review.
6. PPTX/PDF export. Mockup of slides 2/4/8 BEFORE building (house doctrine).
