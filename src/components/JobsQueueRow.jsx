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

import {
  URGENCY,
  fmtDate,
  customerName,
  teamInfo,
} from '../lib/stonebooksData'

const URGENCY_PILL_STYLE = {
  [URGENCY.NEUTRAL]: { text: 'var(--sb-text-muted)', bg: 'transparent',           label: 'In queue' },
  [URGENCY.AMBER]:   { text: 'var(--sb-amber, #b8842a)', bg: 'var(--sb-amber-bg, #fbe5b8)', label: 'Aging' },
  [URGENCY.RED]:     { text: 'var(--sb-red, #b54040)',  bg: 'var(--sb-red-bg, #fbe5e5)',   label: 'Overdue' },
}

const URGENCY_ROW_TINT = {
  [URGENCY.NEUTRAL]: 'transparent',
  [URGENCY.AMBER]:   'rgba(184, 132, 42, 0.045)',
  [URGENCY.RED]:     'rgba(181, 64, 64, 0.055)',
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

export default function JobsQueueRow({ row, onClick, showPlot = false }) {
  const urgency = row.urgency || URGENCY.NEUTRAL
  const stage = row.stage
  const useUrgencyChip = urgency !== URGENCY.NEUTRAL
  const pill = URGENCY_PILL_STYLE[urgency]

  const order = row.order
  const customer = row.customer
  const cemetery = row.cemetery
  const surname = order?.primary_lastname || customerName(customer) || '—'
  const orderNum = order?.order_number || (row.job?.id ? row.job.id.slice(0, 8) : '')

  // Urgency pill — for amber/red the label includes the day count; neutral is
  // a plain "In queue" with no number.
  let pillLabel = pill.label
  if (urgency === URGENCY.RED && row.overdueDays > 0) {
    pillLabel = `Overdue · ${row.overdueDays}d`
  } else if (urgency === URGENCY.AMBER && row.agingDays) {
    pillLabel = `Aging · ${row.agingDays}d`
  }

  const owner = row.owner ? teamInfo(row.owner)?.label : null
  const stoneSize = formatStoneSize(order)
  const secondaryLeft = [cemetery?.name, stoneSize].filter(Boolean).join(' · ')

  // Stage chip styling — yields to urgency ramp when row is amber/red so the
  // row reads as a single signal. Otherwise it uses its palette entry.
  const chipStyle = useUrgencyChip
    ? { color: pill.text, background: pill.bg }
    : (stage ? { color: stage.text, background: stage.bg } : null)
  const chipLabel = row.milestone?.label || stage?.code || ''

  return (
    <button
      type="button"
      className={`sb-queue-row sb-queue-row-${urgency}${showPlot ? ' sb-queue-row-plot' : ''}`}
      onClick={() => onClick?.(row)}
      style={{ background: URGENCY_ROW_TINT[urgency] }}
    >
      <div className="sb-queue-row-identity">
        <div className="sb-queue-row-primary">
          <span className="sb-queue-row-name">{surname}</span>
          {orderNum && <span className="sb-queue-row-id">#{orderNum}</span>}
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
          {row.dueDate ? fmtDate(row.dueDate) : '—'}
        </div>
      )}

      {!showPlot && (
        <div className="sb-queue-row-owner">{owner || '—'}</div>
      )}
    </button>
  )
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
