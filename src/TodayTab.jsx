// =============================================================================
// 📚 Stonebooks — Today (operational briefing surface, v2)
// =============================================================================
// T-2 of the Today v2 migration: signal engine wired into the L1–L5 shell.
//
//   L1 — Morning sentence (still placeholder — T-3 ships the templating engine)
//   L2 — Needs your attention (now populated by todaySignals.js)
//   L3 — Today on the calendar (populated)
//   L4 — Drift watch (populated)
//   L5 — Stewardship roll-up (populated)
//
// Signal rows are pure sentence-form: no chrome, no badges, no labels.
// Urgent L2 items carry a 2px left accent stripe; everything else is calm.
// Each row routes to the relevant Job or Order via the standard handlers.
//
// What this file does NOT do (intentionally deferred):
//   - Morning sentence intelligence (T-3)
//   - Acknowledgement / read-tracking (architecturally out of scope)
//   - Persistent Today state (Today is derived, never stored)
//   - Drift acknowledge / snooze (T-4 layer)
//   - Anticipatory PO / vendor signals (depend on the BI layer)
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { fetchTodayData, deriveTodaySignals } from './lib/todaySignals'

// eslint-disable-next-line no-unused-vars
export default function TodayTab({ user, profile, onOpenSales, onOpenOrder, onOpenJob, onOpenCustomer }) {
  const [data, setData] = useState(null) // { jobs, orders } | null
  const [now] = useState(() => new Date())

  const today = useMemo(() => {
    const d = now
    const day  = d.toLocaleDateString('en-US', { weekday: 'long' })
    const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    return { day, date }
  }, [now])

  // Load operational data on mount. No caching — Today is live.
  useEffect(() => {
    let cancelled = false
    fetchTodayData().then(d => {
      if (!cancelled) setData(d)
    }).catch(err => {
      console.error('[Today] fetch failed:', err)
      if (!cancelled) setData({ jobs: [], orders: [] })
    })
    return () => { cancelled = true }
  }, [])

  const signals = useMemo(() => {
    if (!data) return null
    return deriveTodaySignals({ jobs: data.jobs, orders: data.orders, now })
  }, [data, now])

  const handleClick = (signal) => {
    if (signal.route === 'job'   && onOpenJob)   return onOpenJob(signal.routeId)
    if (signal.route === 'order' && onOpenOrder) return onOpenOrder(signal.routeId)
  }

  return (
    <div className="sb-page sb-today">
      {/* L1 — Morning sentence (placeholder; T-3 ships the live briefing). */}
      <header className="sb-today-head">
        <div className="sb-today-date">{today.day} · {today.date}</div>
        <h1 className="sb-today-sentence">
          Good morning. Five things need you, three installs are scheduled, one signing risk is open.
        </h1>
        <div className="sb-today-sentence-note">
          Placeholder briefing — the live morning sentence ships in a later phase.
        </div>
      </header>

      <TodaySection
        label="Needs your attention"
        signals={signals?.l2}
        loading={signals === null}
        emptyText="Nothing requires your decision right now."
        onClick={handleClick}
      />

      <TodaySection
        label="Today on the calendar"
        signals={signals?.l3}
        loading={signals === null}
        emptyText="Nothing scheduled today."
        onClick={handleClick}
      />

      <TodaySection
        label="Drift watch"
        signals={signals?.l4}
        loading={signals === null}
        emptyText="Nothing has drifted past its typical pace."
        quiet
        onClick={handleClick}
      />

      <TodaySection
        label="Stewardship"
        signals={signals?.l5}
        loading={signals === null}
        emptyText="No upcoming arrivals or deadlines this week."
        quiet
        onClick={handleClick}
      />
    </div>
  )
}

// ─── Section — header + signal list (or empty / loading) ─────────────────────
function TodaySection({ label, signals, loading, emptyText, quiet, onClick }) {
  const cls = quiet ? 'sb-today-section sb-today-section-quiet' : 'sb-today-section'

  return (
    <section className={cls}>
      <h2 className="sb-today-section-label">{label}</h2>

      {loading ? (
        <p className="sb-today-empty sb-today-loading">Reading the day's signals…</p>
      ) : signals && signals.length > 0 ? (
        <div className="sb-today-list">
          {signals.map(s => (
            <SignalRow key={s.id} signal={s} onClick={onClick} />
          ))}
        </div>
      ) : (
        <p className="sb-today-empty">{emptyText}</p>
      )}
    </section>
  )
}

// ─── Signal row — sentence + optional note ──────────────────────────────────
// Two render modes:
//   • Clickable button — the common case. Hover background, focus ring,
//     opens the underlying job/order on click.
//   • Static row       — used for L4 consolidation summaries ("3 more jobs
//     quiet 14+ days — Wilson, Lopez, Garcia."). No subject, no click, no
//     hover. Visually subdued.
function SignalRow({ signal, onClick }) {
  const isStatic = !signal.route
  const base = signal.severity === 'urgent'
    ? 'sb-today-signal sb-today-signal-urgent'
    : 'sb-today-signal'
  const cls = isStatic ? `${base} sb-today-signal-static` : base

  if (isStatic) {
    return (
      <div className={cls}>
        <span className="sb-today-signal-sentence">{signal.sentence}</span>
        {signal.note && <span className="sb-today-signal-note">{signal.note}</span>}
      </div>
    )
  }
  return (
    <button type="button" className={cls} onClick={() => onClick?.(signal)}>
      <span className="sb-today-signal-sentence">{signal.sentence}</span>
      {signal.note && <span className="sb-today-signal-note">{signal.note}</span>}
    </button>
  )
}

// ─── Today v2 — T-2 styles ───────────────────────────────────────────────────
// Sentence-first posture, briefing hierarchy, breathing rhythm.
// Layered visual intensity: full attention on L1/L2, progressively quieter
// through L3–L5. Signal rows are buttons (clickable) with a hairline bottom
// divider and a subtle hover tint. Urgent rows carry a 2px left accent stripe.

const localStyles = `
  .sb-today {
    padding-bottom: 96px;
  }

  /* L1 — Morning sentence block.
     The date is a small quiet eyebrow; the sentence is the page's H1 but
     styled as a sentence, not a title — weight 400 (not 500), generous
     line-height, narrow reading measure so it reads as composed prose. */
  .sb-today-head {
    margin-bottom: 72px;
  }
  .sb-today-date {
    font-size: 14px;
    color: var(--sb-text-muted);
    margin-bottom: 14px;
  }
  .sb-today-sentence {
    font-size: 32px;
    font-weight: 400;
    letter-spacing: -0.012em;
    line-height: 1.32;
    color: var(--sb-text);
    margin: 0;
    max-width: 52ch;
  }
  .sb-today-sentence-note {
    margin-top: 18px;
    font-size: 13px;
    font-style: italic;
    color: var(--sb-text-muted);
  }

  /* L2–L5 — Sections. Same structural shape; quieter variants demote the
     section label color/weight only, not the layout. */
  .sb-today-section {
    margin-bottom: 56px;
  }
  .sb-today-section:last-child {
    margin-bottom: 0;
  }
  .sb-today-section-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 20px;
    letter-spacing: 0;
  }
  .sb-today-section-quiet .sb-today-section-label {
    color: var(--sb-text-secondary);
    font-weight: 400;
  }

  /* Empty / loading state — sentence-form prose, not a card.
     Hairline at the bottom previews the row-divider pattern of real signals. */
  .sb-today-empty {
    font-size: 17px;
    line-height: 1.6;
    color: var(--sb-text-secondary);
    max-width: 60ch;
    margin: 0;
    padding: 4px 0 20px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-today-section-quiet .sb-today-empty {
    color: var(--sb-text-muted);
  }
  .sb-today-loading {
    color: var(--sb-text-muted);
    font-style: italic;
  }

  /* Signal list — column of clickable rows, hairline between, no card chrome. */
  .sb-today-list {
    display: flex;
    flex-direction: column;
  }

  .sb-today-signal {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 0.5px solid var(--sb-border);
    padding: 16px 18px 16px 18px;
    margin: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s;
    position: relative;
  }
  .sb-today-signal:hover {
    background: var(--sb-surface-muted);
  }
  .sb-today-signal:focus-visible {
    outline: none;
    background: var(--sb-surface-muted);
    box-shadow: inset 0 0 0 1px var(--sb-border-hover);
  }

  /* Urgent — 2px left accent stripe. Used sparingly: promise-risk, blocked
     jobs, install-overdue with outstanding balance. Same red as the design
     system's status red, kept thin so the page never reads as a wall of red. */
  .sb-today-signal-urgent {
    box-shadow: inset 2px 0 0 var(--sb-red);
  }
  .sb-today-signal-urgent .sb-today-signal-sentence {
    color: var(--sb-text);
  }

  /* Sentence — the primary read. Design-system md (17px). */
  .sb-today-signal-sentence {
    font-size: 17px;
    line-height: 1.5;
    color: var(--sb-text);
    letter-spacing: -0.005em;
  }

  /* Note — secondary metadata (typically cemetery name). Design-system base (15px). */
  .sb-today-signal-note {
    font-size: 14px;
    line-height: 1.4;
    color: var(--sb-text-muted);
    margin-top: 4px;
  }

  /* Quieter sections soften the sentence color a hair so L4/L5 read as
     calmer than L2 even when populated. */
  .sb-today-section-quiet .sb-today-signal-sentence {
    color: var(--sb-text-secondary);
  }

  /* L4 consolidation summary — static (non-clickable) row. Italic + muted to
     signal "this rolls up several quiet signals; nothing to act on directly."
     Same hairline + padding so vertical rhythm stays intact. */
  .sb-today-signal-static {
    cursor: default;
  }
  .sb-today-signal-static:hover {
    background: transparent;
  }
  .sb-today-signal-static .sb-today-signal-sentence {
    color: var(--sb-text-muted);
    font-style: italic;
  }

  /* Responsive — phone (<600px) tightens type and spacing while preserving
     hierarchy. The morning sentence stays generously sized; it's the briefing
     while walking. */
  @media (max-width: 720px) {
    .sb-today-head {
      margin-bottom: 56px;
    }
    .sb-today-section {
      margin-bottom: 44px;
    }
  }
  @media (max-width: 600px) {
    .sb-today-sentence {
      font-size: 26px;
      line-height: 1.35;
    }
    .sb-today-empty,
    .sb-today-signal-sentence {
      font-size: 16px;
    }
    .sb-today-signal {
      padding: 14px 14px;
    }
  }
`

// Fresh style-tag ID for the v2 shell (was sb-today-tab-styles on the old
// pre-v2 Today). The old tag, if it lingers from hot-reload, no longer has
// matching markup.
if (typeof document !== 'undefined' && !document.getElementById('sb-today-v2-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-v2-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
