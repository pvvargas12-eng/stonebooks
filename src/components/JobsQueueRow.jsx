// =============================================================================
// 📚 Stonebooks — Jobs Queue Row
// =============================================================================
// A single row in a queue panel. CSS-grid layout (not flowing text):
//   identity   |   stage chip   |   urgency pill   |   due date   |   owner
//
// Identity column carries the customer surname + monospace job ID on the
// primary line, cemetery + size on the secondary line. Numeric columns use
// tabular-nums. Subtle row tint reflects the row's urgency state (amber/red);
// neutral rows stay calm. Clicking the row opens the underlying job detail.
//
// When a row earns amber or red urgency, the stage chip yields to the urgency
// ramp so the row reads as one signal, not two competing ones.
// =============================================================================

import { useMemo } from 'react'
import {
  URGENCY,
  fmtDate,
  customerName,
  teamInfo,
  projectJobDates,
  compareMilestoneDates,
  formatMilestoneDateDisplay,
} from '../lib/stonebooksData'

// Standard queue pill — surfaces internal-due-date overdueness or aging.
const URGENCY_PILL_STYLE = {
  [URGENCY.NEUTRAL]: { text: 'var(--sb-text-muted)', bg: 'transparent',           label: 'In queue' },
  [URGENCY.AMBER]:   { text: 'var(--sb-amber, #b8842a)', bg: 'var(--sb-amber-bg, #fbe5b8)', label: 'Aging' },
  [URGENCY.RED]:     { text: 'var(--sb-red, #b54040)',  bg: 'var(--sb-red-bg, #fbe5e5)',   label: 'Overdue' },
}

// "Waiting" variant pill — these queues are tracking an external party we've
// already handed off to (customer for approval, cemetery for permit, supplier
// for stone). The relevant signal is *how long they've been holding it*, and
// whether they're past their quoted-back date. "In queue" doesn't fit —
// nobody internally is "queued" for this work, so we substitute "Waiting Nd".
const WAITING_PILL_STYLE = {
  [URGENCY.NEUTRAL]: { text: 'var(--sb-text-muted)',    bg: 'transparent',                 label: 'Waiting' },
  [URGENCY.AMBER]:   { text: 'var(--sb-amber, #b8842a)', bg: 'var(--sb-amber-bg, #fbe5b8)', label: 'Waiting' },
  [URGENCY.RED]:     { text: 'var(--sb-red, #b54040)',   bg: 'var(--sb-red-bg, #fbe5e5)',   label: 'Past quoted date' },
}

const URGENCY_ROW_TINT = {
  [URGENCY.NEUTRAL]: 'transparent',
  [URGENCY.AMBER]:   'rgba(184, 132, 42, 0.045)',
  [URGENCY.RED]:     'rgba(181, 64, 64, 0.055)',
}

// Days past the external party's quoted resolution date. Returns 0 when the
// milestone has no expected_resolution_at, or when the quoted date is still
// in the future. Used by the waiting-variant pill to render "Past quoted
// date · Nd" — distinct from internal due-date overdueness, which uses the
// existing row.overdueDays.
function _daysPastExpected(milestone) {
  if (!milestone?.expected_resolution_at) return 0
  const expected = new Date(`${milestone.expected_resolution_at.slice(0, 10)}T00:00:00`)
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  if (expected >= t) return 0
  return Math.floor((t - expected) / 86400000)
}

// Secondary-line text for waiting rows. Either "Expected back Jun 14, 2026"
// when the external party gave us a quoted resolution date, or a soft
// "No expected date set" so the row still reads as a tracked hand-off rather
// than something the operator forgot to date.
function _expectedBackText(milestone) {
  if (!milestone?.expected_resolution_at) return 'No expected date set'
  return `Expected back ${fmtDate(milestone.expected_resolution_at)}`
}

function formatStoneSize(order) {
  if (!order) return null
  const c = order.base_config || order.baseConfig
  if (!c) return null
  const w = c.width || c.w
  const h = c.height || c.h
  if (!w || !h) return null
  return `${w}×${h}`
}

export default function JobsQueueRow({
  row,
  onClick,
  showPlot = false,
  variant = null,
  bulkOrders = null,
  selectable = false,
  selected = false,
  onSelectToggle,
}) {
  const urgency = row.urgency || URGENCY.NEUTRAL
  const stage = row.stage
  const useUrgencyChip = urgency !== URGENCY.NEUTRAL
  const isWaiting = variant === 'waiting'
  const pill = isWaiting ? WAITING_PILL_STYLE[urgency] : URGENCY_PILL_STYLE[urgency]

  const order = row.order
  const customer = row.customer
  const cemetery = row.cemetery
  const surname = order?.primary_lastname || customerName(customer) || '—'
  const orderNum = order?.order_number || (row.job?.id ? row.job.id.slice(0, 8) : '')

  // Pill text. Standard buckets read "Overdue · Nd" / "Aging · Nd" / "In queue".
  // Waiting buckets read "Past quoted date · Nd" (when red) or "Waiting Nd"
  // (otherwise). The day count for waiting rows is the aging since last
  // touch — which for an in-progress milestone is the time since the office
  // sent it out. The red-urgency day count for waiting rows comes from the
  // external party's expected_resolution_at via classifyRowUrgency upstream.
  let pillLabel = pill.label
  if (isWaiting) {
    const expectedLate = _daysPastExpected(row.milestone)
    if (urgency === URGENCY.RED && expectedLate > 0) {
      pillLabel = `Past quoted date · ${expectedLate}d`
    } else if (urgency === URGENCY.RED && row.overdueDays > 0) {
      // Internal due_date breached even though no external expectation set.
      pillLabel = `Overdue · ${row.overdueDays}d`
    } else if (row.agingDays != null) {
      pillLabel = `Waiting ${row.agingDays}d`
    }
  } else {
    if (urgency === URGENCY.RED && row.overdueDays > 0) {
      pillLabel = `Overdue · ${row.overdueDays}d`
    } else if (urgency === URGENCY.AMBER && row.agingDays) {
      pillLabel = `Aging · ${row.agingDays}d`
    }
  }

  const owner = row.owner ? teamInfo(row.owner)?.label : null
  const stoneSize = formatStoneSize(order)
  // Waiting rows replace the stone-size half of the secondary line with the
  // expected-back date — the operator's question is "when did they say they'd
  // be done?" not "what size is the stone?".
  const expectedBack = isWaiting ? _expectedBackText(row.milestone) : null
  const secondaryLeft = isWaiting
    ? [cemetery?.name, expectedBack].filter(Boolean).join(' · ')
    : [cemetery?.name, stoneSize].filter(Boolean).join(' · ')

  // Date projection — the date column shows the divergence between the
  // customer-facing promise and the system's projection. When they agree
  // (within 1 day) we show a single date; when they diverge by 2+ days we
  // stack "Promised X" / "Projected Y" with the projected line styled by
  // urgency. Completed milestones show "Done X" muted.
  const projectionMap = useMemo(
    () => projectJobDates(row.job, { bulkOrders: bulkOrders || [] }),
    [row.job, bulkOrders],
  )
  const dateDisplay = useMemo(
    () => formatMilestoneDateDisplay(compareMilestoneDates(row.milestone, projectionMap)),
    [row.milestone, projectionMap],
  )

  // Stage chip styling — yields to urgency ramp when row is amber/red so the
  // row reads as a single signal. Otherwise it uses its palette entry.
  const chipStyle = useUrgencyChip
    ? { color: pill.text, background: pill.bg }
    : (stage ? { color: stage.text, background: stage.bg } : null)
  const chipLabel = row.milestone?.label || stage?.code || ''

  const rowClass = [
    'sb-queue-row',
    `sb-queue-row-${urgency}`,
    showPlot ? 'sb-queue-row-plot' : '',
    selectable ? 'sb-queue-row-selectable' : '',
    selected ? 'sb-queue-row-selected' : '',
  ].filter(Boolean).join(' ')

  // When the section is in multi-select mode, the row is wrapped in a div
  // that holds the checkbox alongside the click button. The button still
  // covers the rest of the grid so the row remains tappable for drill-in.
  // Pre-selectable behavior is unchanged (single <button> row).
  const rowBody = (
    <>
      {selectable && (
        <div
          className="sb-queue-row-checkbox"
          // Stop the click from bubbling to the row button; the label is
          // already inside a flex cell, but click-suppression keeps the row
          // click predictable when the operator drags-or-double-clicks.
          onClick={e => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={!!selected}
            onChange={e => onSelectToggle?.(row, e.target.checked)}
            aria-label={`Select ${surname} ${row.milestone?.label || ''}`}
          />
        </div>
      )}

      <div className="sb-queue-row-identity">
        <div className="sb-queue-row-primary">
          <span className="sb-queue-row-name">{surname}</span>
          {orderNum && <span className="sb-queue-row-id">#{orderNum}</span>}
          {row.department && (
            <span className="sb-queue-row-dept" aria-label={`Owned by ${row.department}`}>
              {row.department}
            </span>
          )}
        </div>
        {showPlot ? (
          <div className="sb-queue-row-secondary">
            {row.plot || 'Plot location pending'}
          </div>
        ) : (
          secondaryLeft && (
            <div className="sb-queue-row-secondary">{secondaryLeft}</div>
          )
        )}
      </div>

      {!showPlot && (
        <div className="sb-queue-row-stage-col">
          {chipStyle && (
            <span className="sb-queue-stage-chip" style={chipStyle}>
              {chipLabel}
            </span>
          )}
        </div>
      )}

      <div className="sb-queue-row-status-col">
        <span
          className="sb-queue-status-pill"
          style={{
            color: pill.text,
            background: pill.bg,
            borderColor: urgency === URGENCY.NEUTRAL ? 'var(--sb-border)' : 'transparent',
          }}
        >
          {pillLabel}
        </span>
      </div>

      {!showPlot && (
        <div className="sb-queue-row-due">
          <DateDisplay display={dateDisplay} fallback={row.dueDate} />
        </div>
      )}

      {!showPlot && (
        <div className="sb-queue-row-owner">{owner || '—'}</div>
      )}
    </>
  )

  return (
    <button
      type="button"
      className={rowClass}
      onClick={() => onClick?.(row)}
      style={{ background: URGENCY_ROW_TINT[urgency] }}
    >
      {rowBody}
    </button>
  )
}

// Date column renderer. Three modes:
//   • done: muted "Done Jun 5"
//   • stacked: two-line "Promised Jun 5" / "Projected Jun 8" with the
//     projected line tone-styled (amber / red on divergence)
//   • single: one line — used when the dates agree or only one is set
// `fallback` is the legacy milestone.due_date — used when no projection is
// available (pre-migration safety net so the column never reads as broken).
function DateDisplay({ display, fallback }) {
  if (!display) {
    return <span>{fallback ? fmtDate(fallback) : '—'}</span>
  }
  if (display.tone === 'done') {
    return <span className="sb-queue-row-due-done">{display.single}</span>
  }
  if (display.promised && display.projected) {
    const projectedClass = display.tone === 'red'
      ? 'sb-queue-row-due-projected-red'
      : display.tone === 'amber'
        ? 'sb-queue-row-due-projected-amber'
        : 'sb-queue-row-due-projected'
    return (
      <span className="sb-queue-row-due-stacked">
        <span className="sb-queue-row-due-promised">Promised {display.promised}</span>
        <span className={projectedClass}>Projected {display.projected}</span>
      </span>
    )
  }
  return <span>{display.single || (fallback ? fmtDate(fallback) : '—')}</span>
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-queue-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px 130px 110px 110px;
    gap: 16px;
    align-items: center;
    width: 100%;
    padding: 14px 18px;
    background: transparent;
    border: none;
    border-bottom: 0.5px solid var(--sb-border);
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s;
  }
  .sb-queue-row:last-child {
    border-bottom: none;
  }
  .sb-queue-row:hover {
    background: var(--sb-surface-muted) !important;
  }
  .sb-queue-row:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: -2px;
  }

  /* Plot-mode grid (cemetery-grouped panel rows) collapses the layout to
     identity + plot description + status pill — the production guy plans
     his trip by plot, not by due date and owner. */
  .sb-queue-row-plot {
    grid-template-columns: minmax(0, 1fr) 130px;
  }

  .sb-queue-row-identity {
    min-width: 0;
  }
  .sb-queue-row-primary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .sb-queue-row-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-queue-row-id {
    font-size: 12px;
    font-family: var(--sb-font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--sb-text-muted);
    white-space: nowrap;
  }
  /* Department chip — only rendered when row.department is set (currently
     from the Owner attention list). Subtle by design: thin bordered pill,
     small caps, muted text. Distinct from the stage chip (which is colored
     by group) and the urgency pill (which is colored by signal). */
  .sb-queue-row-dept {
    font-size: 10px;
    font-weight: 500;
    color: var(--sb-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 0.5px solid var(--sb-border);
    border-radius: 999px;
    padding: 1px 8px;
    white-space: nowrap;
    background: transparent;
  }
  .sb-queue-row-secondary {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-top: 3px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sb-queue-row-stage-col {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .sb-queue-stage-chip {
    display: inline-block;
    max-width: 100%;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-queue-row-status-col {
    display: flex;
    align-items: center;
  }
  .sb-queue-status-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    border: 0.5px solid transparent;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1.4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .sb-queue-row-due {
    font-size: 12px;
    color: var(--sb-text-secondary);
    font-variant-numeric: tabular-nums;
    font-family: var(--sb-font-mono);
    white-space: nowrap;
    line-height: 1.35;
  }
  /* Single-date "Done Jun 5" — completed milestones; muted so a finished
     stage doesn't compete visually with the actionable rows above it. */
  .sb-queue-row-due-done {
    color: var(--sb-text-muted);
    font-style: italic;
  }
  /* Stacked promised + projected when the two diverge by 2+ days. The
     promised line stays muted (it's the historical reference); the
     projected line takes the urgency tone so the operator's eye lands on
     the live forecast. */
  .sb-queue-row-due-stacked {
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
    font-size: 11px;
    line-height: 1.3;
  }
  .sb-queue-row-due-promised {
    color: var(--sb-text-muted);
    text-decoration: line-through;
    text-decoration-color: var(--sb-text-muted);
    text-decoration-thickness: 0.5px;
  }
  .sb-queue-row-due-projected {
    color: var(--sb-text-secondary);
  }
  .sb-queue-row-due-projected-amber {
    color: var(--sb-amber, #b8842a);
    font-weight: 500;
  }
  .sb-queue-row-due-projected-red {
    color: var(--sb-red, #b54040);
    font-weight: 500;
  }

  /* Selectable variant — the section is in multi-select mode; rows get a
     leading checkbox column. Grid widens by ~32px to accommodate. */
  .sb-queue-row-selectable {
    grid-template-columns: 28px minmax(0, 1fr) 180px 130px 110px 110px;
  }
  .sb-queue-row-checkbox {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sb-queue-row-checkbox input {
    cursor: pointer;
    accent-color: var(--sb-accent, #b8842a);
  }
  /* Subtle selected highlight — keeps the row identifiable as the operator
     builds up the multi-select set. */
  .sb-queue-row-selected {
    background: var(--sb-accent-bg, rgba(184, 132, 42, 0.08)) !important;
  }
  .sb-queue-row-owner {
    font-size: 12px;
    color: var(--sb-text-muted);
    text-align: right;
    white-space: nowrap;
  }

  @media (max-width: 1000px) {
    .sb-queue-row {
      grid-template-columns: minmax(0, 1fr) 140px 120px;
    }
    .sb-queue-row-selectable {
      grid-template-columns: 28px minmax(0, 1fr) 140px 120px;
    }
    .sb-queue-row-due,
    .sb-queue-row-owner {
      display: none;
    }
  }
  @media (max-width: 720px) {
    .sb-queue-row {
      grid-template-columns: minmax(0, 1fr) 110px;
      gap: 12px;
      padding: 12px 14px;
    }
    .sb-queue-row-selectable {
      grid-template-columns: 28px minmax(0, 1fr) 110px;
    }
    .sb-queue-row-stage-col {
      display: none;
    }
    .sb-queue-row-plot {
      grid-template-columns: minmax(0, 1fr) 110px;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-jobs-queue-row-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-jobs-queue-row-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
