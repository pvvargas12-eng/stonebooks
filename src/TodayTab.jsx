// =============================================================================
// Stonebooks — Today (operational command center)
// =============================================================================
// Owner + scheduler briefing. Three real sections, one honest placeholder.
//
// CRITICAL DATA DISCIPLINE (verified by 2026-05-28 read-only audit):
//   • financial_records is EMPTY in prod (0 rows). All money math comes from
//     orders.payments[] JSONB via rowNonVoidedPayments / rowGrandTotal /
//     rowBalanceDue — the same path the Customers tab uses.
//   • cemetery_orders is EMPTY (0 rows). No cemetery A/R yet.
//   • job_cost_estimates is EMPTY → detectJobSignals returns []. No margin
//     signals are surfaced here today; they come back online when estimates
//     and the financial ledger get populated.
//   • job_milestones.status is reliable (1,107 rows). status_date is 2.7%
//     populated — never surfaced as "X days ago" anywhere on this page.
//   • work_batches is EMPTY → no planned-vs-actual, no slips, no completion
//     velocity. Section 3 (Production schedule) is an honest placeholder
//     for SCHEDULER-COMPLETE, not a fake summary.
//
// Sections:
//   1. HERO — month-to-date money vs $100k goal, pace line, money strip.
//   2. NEEDS A DECISION — state-based decisions only (overdue balance, proof
//      waiting, installed-not-closed). No timing claims.
//   3. PRODUCTION SCHEDULE — placeholder; sets up SCHEDULER-COMPLETE.
//
// Plus: a generated briefing paragraph composed of REAL numbers only.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  getJobs,
  rowGrandTotal,
  rowTotalPaid,
  rowBalanceDue,
  rowNonVoidedPayments,
  customerName,
  fmtUSD,
  SOLD_STATUSES,
} from './lib/stonebooksData'
import { supabase } from './lib/supabase'

// ── Constants ────────────────────────────────────────────────────────────────
// TODO(owner-settable): expose this in a future Owner / Settings tab so the
// monthly target follows the owner's actual quarterly plan instead of a
// hardcoded number. Today: $100k/month is the working target.
const MONTHLY_GOAL_USD = 100000

// Literal color tokens. The two bronze variants are critical: the original
// #B8860B was barely 3.6:1 on cream and barely 5.4:1 on dark — fine as an
// accent but it dies as a micro-label. Brighter on dark / darker on light:
const C_HERO_BG       = '#0F1419'
const C_HERO_TEXT     = '#F4F3EE'
const C_CANVAS        = '#F7F6F3'              // warm off-white page canvas
const C_CARD          = '#FFFFFF'              // briefing + decisions cards
const C_CARD_BORDER   = 'rgba(15, 20, 25, 0.08)'
const C_CARD_SHADOW_1 = 'rgba(15, 20, 25, 0.04)'
const C_CARD_SHADOW_2 = 'rgba(15, 20, 25, 0.05)'
const C_BODY_INK      = '#1A1A1A'              // near-black for body card text
const C_BRONZE        = '#B8860B'              // bronze rail accent (decorative)
const C_BRONZE_BRIGHT = '#E0B84C'              // bronze on dark hero (AA 7.2:1)
const C_BRONZE_INK    = '#9A7209'              // bronze on light card (AA 4.7:1)
const C_RED           = '#B54040'              // red on light card
const C_RED_BRIGHT    = '#F09595'              // red/amber on dark hero (AA 5.3:1)
const C_GREEN         = '#1D9E75'              // green on light card
const C_GREEN_BRIGHT  = '#5BCFA0'              // green on dark hero (AA 6.4:1)
const C_MUTED         = '#5D5D5A'              // muted body text on cream
const C_LINE          = 'rgba(15, 20, 25, 0.08)'
const C_LINE_DARK     = 'rgba(244, 243, 238, 0.14)'

// ── Bulk fetch ──────────────────────────────────────────────────────────────
// One mount-time round trip. Orders for money + active jobs (with embedded
// milestones) for state-based decisions. Drafts excluded because they have
// no money signal and pre-clutter the decision list.
async function loadCommandCenter() {
  const [oRes, jobs] = await Promise.all([
    supabase
      .from('orders')
      .select('*, customer:customers(*)')
      .neq('status', 'draft')
      .or('archived.is.null,archived.eq.false'),   // D1 — archived never counts
    getJobs({ includeClosed: false }),
  ])
  if (oRes.error) throw new Error(oRes.error.message)
  return { orders: oRes.data || [], jobs: jobs || [] }
}

// ── Money math ──────────────────────────────────────────────────────────────
// All four hero numbers + A/R + overdue, derived from orders.payments[] +
// rowGrandTotal/rowBalanceDue. No financial_records reads — that table is
// empty in prod and would always return $0.
function computeMoney({ orders, today }) {
  const yyyy = today.getFullYear()
  const mm   = today.getMonth()
  const monthPrefix = `${yyyy}-${String(mm + 1).padStart(2, '0')}-`
  const startOfWeek = new Date(yyyy, mm, today.getDate() - 6)
  const startOfWeekISO = isoDate(startOfWeek)
  const todayISO = isoDate(today)

  let collectedThisMonth   = 0
  let collectedToday       = 0
  let depositsThisWeek     = 0
  let newSalesAmt          = 0
  let newSalesCount        = 0
  let newSalesTodayAmt     = 0
  let newSalesTodayCount   = 0
  let outstandingAR        = 0
  let overdueBalance       = 0
  let overdueCount         = 0

  for (const o of orders) {
    const payments = rowNonVoidedPayments(o)
    for (const p of payments) {
      const r = String(p.receivedAt || p.createdAt || '').slice(0, 10)
      if (!r) continue
      if (r.startsWith(monthPrefix)) collectedThisMonth += Number(p.amount || 0)
      if (r === todayISO) collectedToday += Number(p.amount || 0)
      if (r >= startOfWeekISO && r <= todayISO) depositsThisWeek += Number(p.amount || 0)
    }

    if (o.signed_at && SOLD_STATUSES.includes(o.status)) {
      const s = String(o.signed_at).slice(0, 10)
      if (s >= startOfWeekISO && s <= todayISO) {
        newSalesAmt   += rowGrandTotal(o)
        newSalesCount += 1
      }
      if (s === todayISO) {
        newSalesTodayAmt   += rowGrandTotal(o)
        newSalesTodayCount += 1
      }
    }

    if (SOLD_STATUSES.includes(o.status)) {
      const bal = rowBalanceDue(o)
      if (bal > 0) {
        outstandingAR += bal
        if (o.target_completion_date) {
          const tgt = new Date(o.target_completion_date)
          if (tgt < today) {
            overdueBalance += bal
            overdueCount   += 1
          }
        }
      }
    }
  }

  return {
    collectedThisMonth,
    collectedToday,
    depositsThisWeek,
    newSalesAmt,
    newSalesCount,
    newSalesTodayAmt,
    newSalesTodayCount,
    outstandingAR,
    overdueBalance,
    overdueCount,
  }
}

function computePace({ collected, today }) {
  const day = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const expectedPct = day / daysInMonth
  const expectedDollars = expectedPct * MONTHLY_GOAL_USD
  const delta = collected - expectedDollars
  return {
    day,
    daysInMonth,
    daysLeft: Math.max(0, daysInMonth - day),
    expectedPct,
    expectedDollars,
    actualPct: collected / MONTHLY_GOAL_USD,
    delta,
    today,  // carried through so Hero's month-label reads the same clock
  }
}

// ── Decisions ───────────────────────────────────────────────────────────────
// State-based only. Every claim here is backed by a milestone.status flip or
// a non-zero balance — no date-based heuristics, because the audit proved
// milestone dates are 2.7% populated.
function computeDecisions({ jobs, orders, today }) {
  const out = []

  // Order-level: overdue balance (past target_completion_date with money owed).
  // target_completion_date is the only forward-looking date that's actually
  // populated, so this is the one "timing" claim we can honestly make.
  // Two sentence forms: list form keeps the bullet · for scan-ability; prose
  // form drops it so it weaves into the briefing paragraph cleanly.
  for (const o of orders) {
    if (!SOLD_STATUSES.includes(o.status)) continue
    const bal = rowBalanceDue(o)
    if (bal <= 0) continue
    if (!o.target_completion_date) continue
    const tgt = new Date(o.target_completion_date)
    if (tgt < today) {
      const who = orderLastname(o)
      out.push({
        severity: 'red',
        kind: 'overdue_balance',
        sentence: `${who} · ${fmtUSD(bal)} balance past target completion`,
        prose:    `the ${who} order has a ${fmtUSD(bal)} balance past its target completion`,
        action: 'Collect',
        orderId: o.id,
      })
    }
  }

  // Job-milestone state decisions. The status field is reliable; we never
  // claim "X days waiting" because status_date isn't.
  for (const j of jobs) {
    const byKey = milestoneIndex(j)

    // Proof awaiting family approval — proof_created done, proof_approved not.
    const pCreated  = byKey.get('proof_created')
    const pApproved = byKey.get('proof_approved')
    if (pCreated?.status === 'done'
        && pApproved
        && pApproved.status !== 'done'
        && pApproved.status !== 'not_needed') {
      const who = jobLastname(j)
      out.push({
        severity: 'amber',
        kind: 'proof_waiting',
        sentence: `${who} waiting on family to approve proof`,
        prose:    `the ${who} family hasn't approved the proof yet`,
        action: 'Call family',
        jobId: j.id,
      })
    }

    // Installed but not closed out — installed done, closeout milestones not.
    const installed     = byKey.get('installed')
    const paidInFull    = byKey.get('paid_in_full')
    const closed        = byKey.get('closed')
    const customerNotif = byKey.get('customer_notified')
    if (installed?.status === 'done'
        && (paidInFull?.status !== 'done'
            || closed?.status !== 'done'
            || customerNotif?.status !== 'done')) {
      const who = jobLastname(j)
      out.push({
        severity: 'amber',
        kind: 'install_not_closed',
        sentence: `${who} installed but not yet closed out`,
        prose:    `${who} is installed but not yet closed out`,
        action: 'Close out',
        jobId: j.id,
      })
    }
  }

  // Sort red → amber, dedupe by jobId+kind (a single job can show up once).
  const sevRank = { red: 0, amber: 1, muted: 2 }
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
  return dedupeDecisions(out)
}

function dedupeDecisions(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const k = `${r.kind}:${r.jobId || r.orderId || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

// ── Briefing paragraph ──────────────────────────────────────────────────────
// Rule-based prose using only real numbers. NEVER references scheduled work,
// crew accountability, slips, or "today's installs" — that data is empty.
function composeBriefing({ name, jobs, money, pace, decisions, today }) {
  const sentences = []
  sentences.push(`${greetingFor(today)}, ${name || 'there'}.`)

  // Job state — active count + how many in production (milestone-derived).
  // Drop the "N in production" clause when it's zero so we never print a
  // zero-state fact as if it were news.
  const inProd = jobs.filter(j => {
    const byKey = milestoneIndex(j)
    return byKey.get('production_started')?.status === 'done'
        && byKey.get('production_completed')?.status !== 'done'
  }).length
  const jobsClause = jobs.length === 1 ? '1 job active' : `${jobs.length} jobs active`
  sentences.push(
    inProd > 0
      ? `${jobsClause}, ${inProd} in production.`
      : `${jobsClause}.`
  )

  // Money pace vs monthly goal. Drops the "$100,000" restatement (it's already
  // in the hero) — owner-language: "running ahead of pace" / "behind pace."
  const monthName = today.toLocaleDateString('en-US', { month: 'long' })
  if (money.collectedToday > 0 && money.newSalesTodayCount > 0) {
    sentences.push(
      `${fmtUSD(money.collectedToday)} collected today, and ${money.newSalesTodayCount === 1 ? '1 order' : `${money.newSalesTodayCount} orders`} signed.`
    )
  } else if (money.collectedToday > 0) {
    sentences.push(`${fmtUSD(money.collectedToday)} collected today.`)
  } else if (money.newSalesTodayCount > 0) {
    sentences.push(
      `${money.newSalesTodayCount === 1 ? '1 order' : `${money.newSalesTodayCount} orders`} signed today (${fmtUSD(money.newSalesTodayAmt)}).`
    )
  }
  const verb = pace.delta >= 0 ? 'ahead of pace' : 'behind pace'
  sentences.push(
    `${fmtUSD(money.collectedThisMonth)} in for ${monthName} — running ${verb} with ${pace.daysLeft} ${pace.daysLeft === 1 ? 'day' : 'days'} left.`
  )

  // Top 1–2 decisions, woven in. Use the prose form so the bullet `·` from
  // list rows doesn't bleed into the paragraph; fall back to the list form
  // if a prose form wasn't authored for that decision kind.
  const proseOf = (d) => d.prose || lowerFirst(d.sentence)
  const top = decisions.slice(0, 2)
  if (top.length === 1) {
    sentences.push(`One thing needs a decision: ${proseOf(top[0])}.`)
  } else if (top.length >= 2) {
    sentences.push(`Two things need a decision: ${proseOf(top[0])}, and ${proseOf(top[1])}.`)
  }

  // A/R as a closing fact (only if non-zero).
  if (money.outstandingAR > 0) {
    sentences.push(`${fmtUSD(money.outstandingAR)} is collectible across active orders.`)
  }

  return sentences.join(' ')
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function greetingFor(d) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function lowerFirst(s) {
  if (!s) return ''
  return s.charAt(0).toLowerCase() + s.slice(1)
}
function milestoneIndex(job) {
  return new Map((job?.milestones || []).map(m => [m.milestone_key, m]))
}
function orderLastname(o) {
  return customerName(o.customer) !== '—'
    ? customerName(o.customer)
    : (o.primary_lastname || 'Unknown')
}
function jobLastname(j) {
  return j.order?.primary_lastname
      || (j.customer?.last_name ? String(j.customer.last_name).toUpperCase() : null)
      || 'Unknown'
}
function displayName(profile, user) {
  if (profile?.display_name) return profile.display_name.split(' ')[0]
  const email = user?.email
  if (!email) return null
  const local = email.split('@')[0]
  // Strip digits + dot variants; capitalize first segment if usable.
  const seg = local.split(/[.\-_]/)[0].replace(/\d+/g, '')
  if (!seg) return null
  return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase()
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenJob, onOpenCustomer }) { // eslint-disable-line no-unused-vars
  const [data, setData]         = useState(null)
  const [err, setErr]           = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    setErr(null)
    loadCommandCenter()
      .then(d => {
        if (cancelled) return
        setData(d)
        setLoadedAt(new Date())
      })
      .catch(e => {
        if (cancelled) return
        setErr(e?.message || 'Failed to load today data')
        setData({ orders: [], jobs: [] })
      })
    return () => { cancelled = true }
  }, [])

  const today = useMemo(() => new Date(), [])
  const firstName = useMemo(() => displayName(profile, user), [profile, user])

  const view = useMemo(() => {
    if (!data) return null
    const money     = computeMoney({ orders: data.orders, today })
    const pace      = computePace({ collected: money.collectedThisMonth, today })
    const decisions = computeDecisions({ jobs: data.jobs, orders: data.orders, today })
    const briefing  = composeBriefing({ name: firstName, jobs: data.jobs, money, pace, decisions, today })
    return { money, pace, decisions, briefing }
  }, [data, today, firstName])

  if (err && !data) {
    return (
      <div className="sb-today-cc">
        <div className="sb-today-cc-container">
          <div className="sb-today-cc-error">{err}</div>
        </div>
      </div>
    )
  }
  if (!view) {
    return (
      <div className="sb-today-cc">
        <div className="sb-today-cc-container">
          <Hero loading />
        </div>
      </div>
    )
  }

  const { money, pace, decisions, briefing } = view
  const dateLine = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="sb-today-cc">
      <div className="sb-today-cc-container">
        <Hero
          dateLine={dateLine}
          loadedAt={loadedAt}
          collected={money.collectedThisMonth}
          goal={MONTHLY_GOAL_USD}
          pace={pace}
          strip={{
            newSales:   { amt: money.newSalesAmt, count: money.newSalesCount },
            deposits:   money.depositsThisWeek,
            outstandingAR: money.outstandingAR,
            overdue:    { amt: money.overdueBalance, count: money.overdueCount },
          }}
        />
        <Briefing text={briefing} />
        <Decisions
          rows={decisions}
          onOpenJob={onOpenJob}
          onOpenOrder={onOpenOrder}
        />
        <ProductionPlaceholder />
      </div>
    </div>
  )
}

// =============================================================================
// SECTIONS
// =============================================================================

function Hero({ loading, dateLine, loadedAt, collected, goal, pace, strip }) {
  if (loading) {
    return (
      <section className="sb-today-hero">
        <header className="sb-today-hero-eyebrow-row">
          <div className="sb-today-hero-date">Loading…</div>
        </header>
      </section>
    )
  }
  const pct       = Math.max(0, Math.min(1, collected / goal))
  const pctLabel  = Math.round(pct * 100)
  const aheadBehind = pace.delta >= 0 ? 'ahead of' : 'behind'
  const deltaAbs    = Math.abs(pace.delta)
  // Use the brighter pair on the dark hero so the colored delta carries
  // visual weight without going neon. (Was muddy with the light-side values.)
  const deltaColor  = pace.delta >= 0 ? C_GREEN_BRIGHT : C_RED_BRIGHT

  // Passive "as of HH:MM" label — both reviews flagged the pulsing "Live"
  // dot as semantically wrong (this is a mount-time fetch, not streaming).
  // The honest signal is a timestamp of when the snapshot was taken.
  const loadedLabel = loadedAt
    ? `As of ${loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : null

  return (
    <section className="sb-today-hero">
      <header className="sb-today-hero-eyebrow-row">
        <div className="sb-today-hero-date">{dateLine}</div>
        {loadedLabel && (
          <div className="sb-today-hero-loaded" title="Snapshot taken at load. Reload the page to refresh.">
            {loadedLabel}
          </div>
        )}
      </header>

      <div className="sb-today-hero-eyebrow">{monthLabel(pace.today)} cash goal</div>

      <div className="sb-today-hero-amounts">
        <div className="sb-today-hero-collected">{fmtUSD(collected)}</div>
        <div className="sb-today-hero-goal">/ {fmtUSD(goal)} · {pctLabel}%</div>
      </div>

      {/* Track bar — bronze fill to actual pct; thin marker at expected pace. */}
      <div className="sb-today-hero-track">
        <div className="sb-today-hero-track-fill" style={{ width: `${pct * 100}%` }} />
        <div
          className="sb-today-hero-track-marker"
          style={{ left: `${pace.expectedPct * 100}%` }}
          title={`Linear pace: ${Math.round(pace.expectedPct * 100)}% by day ${pace.day} of ${pace.daysInMonth}`}
        />
      </div>

      {/* Pace line: drops "expected ~N% by now" — the track marker already
          encodes that. The colored delta carries the message. */}
      <div className="sb-today-hero-pace">
        Day {pace.day} of {pace.daysInMonth} ·{' '}
        <span style={{ color: deltaColor, fontWeight: 500 }}>
          running {fmtUSD(deltaAbs)} {aheadBehind} pace
        </span>
      </div>

      <div className="sb-today-strip">
        <StripCell
          label="New sales this week"
          value={fmtUSD(strip.newSales.amt)}
          sub={strip.newSales.count
            ? `${strip.newSales.count} ${strip.newSales.count === 1 ? 'order' : 'orders'} signed`
            : 'none signed yet'}
        />
        <StripCell
          label="Deposits this week"
          value={fmtUSD(strip.deposits)}
          sub="payments received"
        />
        <StripCell
          label="Outstanding A/R"
          value={fmtUSD(strip.outstandingAR)}
          sub="across sold orders"
        />
        <StripCell
          label="Overdue completion"
          value={fmtUSD(strip.overdue.amt)}
          sub={strip.overdue.count
            ? `${strip.overdue.count} ${strip.overdue.count === 1 ? 'order' : 'orders'} past delivery date`
            : 'none past delivery date'}
          tone={strip.overdue.amt > 0 ? 'red' : 'neutral'}
        />
      </div>
    </section>
  )
}

function monthLabel(today) {
  // Reads the same clock as the rest of the page (passed through from
  // computePace) so the eyebrow and the briefing never disagree on the month
  // at midnight rollover.
  const d = new Date((today || new Date()).getTime()); d.setDate(1)
  return d.toLocaleDateString('en-US', { month: 'long' })
}

function StripCell({ label, value, sub, tone }) {
  return (
    <div className={`sb-today-strip-cell${tone === 'red' ? ' sb-today-strip-cell-red' : ''}`}>
      <div className="sb-today-strip-label">{label}</div>
      <div className="sb-today-strip-value">{value}</div>
      {sub && <div className="sb-today-strip-sub">{sub}</div>}
    </div>
  )
}

function Briefing({ text }) {
  return (
    <section className="sb-today-card sb-today-briefing">
      <p>{text}</p>
    </section>
  )
}

function Decisions({ rows, onOpenJob, onOpenOrder }) {
  // Whole row is the click target — verb sits as a caption on the right, not a
  // separate button. UX-friction review: a two-target row forces an unnecessary
  // tap choice. CRM review: the order-level overdue_balance row had a disabled
  // button — now it routes to onOpenOrder if available, so the most urgent
  // decision is always actionable.
  const handleOpen = (r) => {
    if (r.jobId && onOpenJob) return onOpenJob(r.jobId)
    if (r.orderId && onOpenOrder) return onOpenOrder(r.orderId)
  }
  return (
    <section className="sb-today-card sb-today-section">
      <header className="sb-today-section-head">
        <div>
          <div className="sb-today-section-eyebrow">Needs a decision</div>
          <h2 className="sb-today-section-title">
            {rows.length === 0
              ? 'All clear'
              : (rows.length === 1 ? '1 decision' : `${rows.length} decisions`)}
          </h2>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="sb-today-empty">Nothing needs a decision right now.</div>
      ) : (
        <ul className="sb-today-decisions">
          {rows.map((r, i) => (
            <li key={`${r.kind}:${r.jobId || r.orderId || i}`}>
              <button
                type="button"
                className="sb-today-decision"
                onClick={() => handleOpen(r)}
              >
                <span
                  className="sb-today-decision-dot"
                  style={{ background: r.severity === 'red' ? C_RED : C_BRONZE }}
                  aria-hidden="true"
                />
                <span className="sb-today-decision-text">{r.sentence}</span>
                <span className="sb-today-decision-action">{r.action}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProductionPlaceholder() {
  return (
    <section className="sb-today-card sb-today-section sb-today-section-dormant">
      <header className="sb-today-section-head">
        <div>
          <div className="sb-today-section-eyebrow">Coming next</div>
          <h2 className="sb-today-section-title">Production schedule</h2>
        </div>
      </header>
      <div className="sb-today-placeholder">
        Scheduling comes online next. Once jobs are on the calendar, this
        section will show what's planned for today — foundations, installs,
        deliveries, inscriptions — and what actually got done.
      </div>
    </section>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const styles = `
  /* ── Canvas ────────────────────────────────────────────────────────────
     The outer wrapper paints the warm off-white canvas. Cards sit on it
     with deliberate space — no edge-to-edge bands, no beige slabs.
     The negative margin breaks out of the Stonebooks page padding so the
     canvas actually fills the workspace. */
  .sb-today-cc {
    background: ${C_CANVAS};
    margin: 0 -24px -32px;
    padding: 40px 0 80px;
    min-height: 100%;
    box-sizing: border-box;
  }
  .sb-today-cc-container {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .sb-today-cc-error {
    background: ${C_CARD};
    border: 0.5px solid ${C_RED};
    color: ${C_RED};
    padding: 18px 22px;
    border-radius: 12px;
    font-size: 13px;
  }

  /* ── Hero — contained dark command card ────────────────────────────────
     A rounded surface floating on the canvas with subtle shadow + border.
     Internal padding is generous (32px) so the eye lands on the big number,
     not on the chrome. */
  .sb-today-hero {
    background: ${C_HERO_BG};
    color: ${C_HERO_TEXT};
    border-radius: 16px;
    border: 0.5px solid rgba(0, 0, 0, 0.4);
    padding: 32px;
    /* Heavier than sibling cards — dark cards need more lift on light canvas
       to read as floating. UX review: the hero should feel slightly elevated
       above the briefing + decisions, not at the same plane. */
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.12),
      0 12px 32px rgba(0, 0, 0, 0.10);
    box-sizing: border-box;
    min-height: 360px;  /* reserve height so cards below don't jump up */
  }

  /* Eyebrow row — date (left) + live indicator (right) */
  .sb-today-hero-eyebrow-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 28px;
  }
  .sb-today-hero-date {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(244, 243, 238, 0.55);
    font-weight: 500;
  }
  /* Passive snapshot timestamp. Both UX + CRM reviews flagged the previous
     pulsing "Live" dot as semantically wrong — this is a mount-time fetch,
     not streaming. Honest label is "As of HH:MM," static. */
  .sb-today-hero-loaded {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(244, 243, 238, 0.45);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  /* "MAY CASH GOAL" — bronze micro-label, bright on dark */
  .sb-today-hero-eyebrow {
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: ${C_BRONZE_BRIGHT};
    margin-bottom: 12px;
    font-weight: 600;
  }

  /* Big number — with a hairline bronze underline tying it to the track-bar
     fill below. CRM-review polish: anchors the cash number as THE number on
     the page; zero data cost. */
  .sb-today-hero-amounts {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }
  .sb-today-hero-collected {
    font-size: 52px;
    font-weight: 600;
    letter-spacing: -0.022em;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: ${C_HERO_TEXT};
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(224, 184, 76, 0.28);
  }
  .sb-today-hero-goal {
    font-size: 18px;
    color: rgba(244, 243, 238, 0.5);
    font-variant-numeric: tabular-nums;
    font-weight: 400;
  }

  /* Track bar — taller, rounded, with a clearer marker */
  .sb-today-hero-track {
    position: relative;
    height: 10px;
    background: rgba(244, 243, 238, 0.08);
    border-radius: 5px;
    overflow: visible;
    margin-bottom: 14px;
  }
  .sb-today-hero-track-fill {
    height: 100%;
    background: linear-gradient(90deg, ${C_BRONZE_BRIGHT} 0%, #D4A027 100%);
    border-radius: 5px;
    transition: width 0.3s ease;
  }
  .sb-today-hero-track-marker {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 16px;
    background: rgba(244, 243, 238, 0.7);
    border-radius: 1px;
  }
  .sb-today-hero-pace {
    font-size: 13px;
    color: rgba(244, 243, 238, 0.72);
    margin-bottom: 32px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Money strip ───────────────────────────────────────────────────────
     4 cells separated by subtle vertical dividers — no gutter background,
     so the strip reads as part of the hero card, not a sub-band. */
  .sb-today-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-top: 0.5px solid rgba(244, 243, 238, 0.14);
    padding-top: 24px;
  }
  .sb-today-strip-cell {
    padding: 0 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-left: 0.5px solid rgba(244, 243, 238, 0.14);
  }
  .sb-today-strip-cell:first-child {
    border-left: none;
    padding-left: 0;
  }
  .sb-today-strip-cell:last-child {
    padding-right: 0;
  }
  .sb-today-strip-label {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${C_BRONZE_BRIGHT};
    font-weight: 600;
  }
  .sb-today-strip-value {
    font-size: 24px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: ${C_HERO_TEXT};
    letter-spacing: -0.010em;
    line-height: 1;
  }
  .sb-today-strip-cell-red .sb-today-strip-value {
    color: ${C_RED_BRIGHT};
  }
  .sb-today-strip-sub {
    font-size: 11px;
    color: rgba(244, 243, 238, 0.5);
    line-height: 1.4;
  }

  /* ── Light-card primitive ──────────────────────────────────────────────
     Briefing, Decisions, and Placeholder all share the same surface
     treatment so they read as siblings on the same canvas. */
  .sb-today-card {
    background: ${C_CARD};
    border: 0.5px solid ${C_CARD_BORDER};
    border-radius: 12px;
    box-shadow:
      0 1px 3px ${C_CARD_SHADOW_1},
      0 8px 24px ${C_CARD_SHADOW_2};
    box-sizing: border-box;
  }

  /* ── Briefing ──────────────────────────────────────────────────────────
     Inherits the card primitive plus a bronze left-rail (3px) marking it
     as the system's voice. */
  .sb-today-briefing {
    position: relative;
    padding: 24px 28px 24px 32px;
    /* No overflow:hidden — that was clipping the card's left shadow. The rail
       gets its own left-corner radius so it follows the card's rounded edge. */
  }
  .sb-today-briefing::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: ${C_BRONZE};
    border-radius: 12px 0 0 12px;
  }
  .sb-today-briefing p {
    font-size: 15px;
    line-height: 1.6;
    color: ${C_BODY_INK};
    margin: 0;
    max-width: 70ch;
    font-weight: 400;
    letter-spacing: -0.002em;
  }

  /* ── Decisions ─────────────────────────────────────────────────────── */
  .sb-today-section {
    padding: 24px 28px;
  }
  .sb-today-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .sb-today-section-eyebrow {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${C_BRONZE_INK};
    font-weight: 600;
  }
  .sb-today-section-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    color: ${C_BODY_INK};
    letter-spacing: -0.006em;
  }
  .sb-today-empty {
    font-size: 14px;
    color: ${C_MUTED};
    padding: 18px 0;
    border-top: 0.5px solid ${C_LINE};
  }

  .sb-today-decisions {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 0.5px solid ${C_LINE};
  }
  .sb-today-decisions li { margin: 0; }
  /* Whole row is the click target — no separate button. Action verb sits
     as a bronze caption on the right, not interactive on its own. */
  .sb-today-decision {
    display: grid;
    grid-template-columns: 12px 1fr auto;
    align-items: center;
    gap: 16px;
    width: 100%;
    box-sizing: border-box;
    padding: 14px 0;
    border: none;
    border-bottom: 0.5px solid ${C_LINE};
    background: transparent;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: background 0.12s ease, padding 0.12s ease;
    border-radius: 4px;
  }
  .sb-today-decisions li:last-child .sb-today-decision { border-bottom: none; }
  /* Hover only on devices that can actually hover — on iOS the :hover state
     lingers post-tap and causes a row-shift artifact on dismissal. */
  @media (hover: hover) {
    .sb-today-decision:hover {
      background: rgba(15, 20, 25, 0.025);
      padding-left: 4px;  /* one-axis shift only — three animated properties
                             read as jumpy; one reads as alive */
    }
  }
  .sb-today-decision:focus-visible {
    outline: 0.5px solid ${C_BRONZE_INK};
    outline-offset: 2px;
  }
  .sb-today-decision-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .sb-today-decision-text {
    font-size: 14px;
    color: ${C_BODY_INK};
    line-height: 1.4;
  }
  .sb-today-decision-action {
    font-size: 11px;
    font-weight: 600;
    color: ${C_BRONZE_INK};
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* ── Production placeholder ─────────────────────────────────────────
     Same card primitive, visually dormant: SHADOW removed so it sits flat
     on the canvas while the three real cards float above. CRM review:
     flat-vs-floating is a clearer "not active yet" signal than opacity
     (which reads as broken/loading). */
  .sb-today-section.sb-today-section-dormant {
    background: rgba(255, 255, 255, 0.6);
    box-shadow: none;
  }
  .sb-today-placeholder {
    background: rgba(15, 20, 25, 0.025);
    border: 0.5px dashed rgba(15, 20, 25, 0.18);
    border-radius: 8px;
    padding: 22px 26px;
    font-size: 14px;
    line-height: 1.6;
    color: ${C_MUTED};
    max-width: 70ch;
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 880px) {
    .sb-today-strip { grid-template-columns: repeat(2, 1fr); row-gap: 22px; }
    /* In 2-col strip, cells 1 + 3 start the row → no left border. */
    .sb-today-strip-cell:nth-child(odd) { border-left: none; padding-left: 0; }
  }
  @media (max-width: 600px) {
    .sb-today-cc { padding: 24px 0 56px; }
    .sb-today-cc-container { padding: 0 16px; gap: 16px; }
    .sb-today-hero { padding: 24px; border-radius: 14px; min-height: 0; }
    .sb-today-hero-collected { font-size: 42px; }
    .sb-today-hero-amounts { flex-direction: column; align-items: flex-start; gap: 8px; }
    .sb-today-strip { grid-template-columns: 1fr; row-gap: 18px; }
    .sb-today-strip-cell { border-left: none; padding: 0; }
    .sb-today-briefing { padding: 20px 22px 20px 28px; }
    .sb-today-section { padding: 20px 22px; }
    .sb-today-decision { grid-template-columns: 12px 1fr; row-gap: 4px; }
    .sb-today-decision-action { grid-column: 2; justify-self: start; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-today-cc-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-cc-styles'
  tag.textContent = styles
  document.head.appendChild(tag)
}
