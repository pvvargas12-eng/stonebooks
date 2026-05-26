// =============================================================================
// 📚 Stonebooks — Today Row
// =============================================================================
// One milestone surfaced on the Today operational page. Layout intentionally
// inverts the JobsQueueRow hierarchy: the next-action verb-phrase is the
// primary read, identity (#order_number · cemetery) is the anchor on the
// secondary line. The operator reads what to do first, then "for whom."
//
// CSS-grid: action+identity | stage chip | urgency pill | owner. The same
// shape as JobsQueueRow's grid, but the left column is the verb-phrase, not
// the surname.
//
// Stage chip yields to urgency on overdue/aging rows so each row reads as a
// single signal, not two competing ones.
// =============================================================================

import { useMemo } from 'react'
import {
  URGENCY,
  teamInfo,
  projectJobDates,
  compareMilestoneDates,
  formatMilestoneDateDisplay,
} from '../lib/stonebooksData'
import PromiseBadge from './scheduler/PromiseBadge'

const URGENCY_PILL_STYLE = {
  [URGENCY.NEUTRAL]: { text: 'var(--sb-text-muted)',       bg: 'transparent',                    label: 'Due today' },
  [URGENCY.AMBER]:   { text: 'var(--sb-amber, #b8842a)',   bg: 'var(--sb-amber-bg, #fbe5b8)',    label: 'Aging' },
  [URGENCY.RED]:     { text: 'var(--sb-red, #b54040)',     bg: 'var(--sb-red-bg, #fbe5e5)',      label: 'Overdue' },
}

const URGENCY_ROW_TINT = {
  [URGENCY.NEUTRAL]: 'transparent',
  [URGENCY.AMBER]:   'rgba(184, 132, 42, 0.045)',
  [URGENCY.RED]:     'rgba(181, 64, 64, 0.06)',
}

// Two-letter role initials displayed at the right of the row. Same vocabulary
// as the role selector. Kept here (not in teamInfo) because the abbreviation
// is purely a Today-row concern.
const TEAM_INITIALS = {
  admin:        'AD',
  design:       'DS',
  sales:        'SL',
  production:   'PR',
  installation: 'IN',
}

export default function TodayRow({ row, onClick, urgency: urgencyOverride, bulkOrders = null, promise = null }) {
  const urgency = urgencyOverride || row.urgency || URGENCY.NEUTRAL
  const pill = URGENCY_PILL_STYLE[urgency]
  const stage = row.stage
  const useUrgencyChip = urgency !== URGENCY.NEUTRAL

  const order = row.order
  const cemetery = row.cemetery
  const surname = row.surname || order?.primary_lastname || '—'
  const orderNum = order?.order_number || (row.job?.id ? row.job.id.slice(0, 8) : '')

  // Pill text — overdue carries a day count, aging carries a day count, neutral
  // stays simple ("Due today").
  let pillLabel = pill.label
  if (urgency === URGENCY.RED && row.overdueDays > 0) {
    pillLabel = `Overdue · ${row.overdueDays}d`
  } else if (urgency === URGENCY.AMBER && row.agingDays) {
    pillLabel = `Aging · ${row.agingDays}d`
  }

  // Stage chip yields to urgency ramp on amber/red rows so the row reads as a
  // single signal. Chip label is the milestone label — short, recognizable.
  const chipStyle = useUrgencyChip
    ? { color: pill.text, background: pill.bg }
    : (stage ? { color: stage.text, background: stage.bg } : null)
  const chipLabel = row.milestone?.label || stage?.code || ''

  // Owner initials. Falls back to em-dash so the column never collapses.
  const owner = row.owner || null
  const ownerInitials = owner ? (TEAM_INITIALS[owner] || teamInfo(owner)?.label?.slice(0, 2)?.toUpperCase() || '—') : '—'

  // Secondary identity line — order number + cemetery. Surname is folded into
  // the next-action phrase ("Sandblast Anderson"); the identity line carries
  // the "for whom" anchor so the operator can confirm before clicking.
  const idParts = []
  if (orderNum) idParts.push(`#${orderNum}`)
  if (surname && surname !== '—') idParts.push(surname)
  if (cemetery?.name) idParts.push(cemetery.name)
  const secondary = idParts.join(' · ')

  // Primary line — verb-phrase. Falls back to milestone label only if no
  // nextAction came through (shouldn't happen post-derive, but defensive).
  const primary = row.nextAction || row.milestone?.label || 'Action needed'

  // Date projection — only surfaced when the customer promise and the
  // system projection diverge by 2+ days. Keeps Today's row calm by default;
  // when a divergence appears, it reads as a single tertiary line beneath
  // the identity row ("Promised Jun 5 · Projected Jun 8" in the tone of the
  // divergence). Pre-migration contract_due_at is null → never shows.
  const projectionMap = useMemo(
    () => projectJobDates(row.job, { bulkOrders: bulkOrders || [] }),
    [row.job, bulkOrders],
  )
  const dateDisplay = useMemo(
    () => formatMilestoneDateDisplay(compareMilestoneDates(row.milestone, projectionMap)),
    [row.milestone, projectionMap],
  )
  const showDivergence = !!(dateDisplay?.promised && dateDisplay?.projected)
  const divergenceClass = dateDisplay?.tone === 'red'
    ? 'sb-today-row-divergence sb-today-row-divergence-red'
    : dateDisplay?.tone === 'amber'
      ? 'sb-today-row-divergence sb-today-row-divergence-amber'
      : 'sb-today-row-divergence'

  return (
    <button
      type="button"
      className={`sb-today-row sb-today-row-${urgency}`}
      onClick={() => onClick?.(row)}
      style={{ background: URGENCY_ROW_TINT[urgency] }}
    >
      <div className="sb-today-row-body">
        <div className="sb-today-row-primary">
          <span>{primary}</span>
          {promise && <PromiseBadge promise={promise} size="sm" />}
        </div>
        {secondary && (
          <div className="sb-today-row-secondary">{secondary}</div>
        )}
        {showDivergence && (
          <div className={divergenceClass}>
            Promised {dateDisplay.promised} · Projected {dateDisplay.projected}
          </div>
        )}
      </div>

      <div className="sb-today-row-stage-col">
        {chipStyle && (
          <span className="sb-today-row-chip" style={chipStyle}>
            {chipLabel}
          </span>
        )}
      </div>

      <div className="sb-today-row-status-col">
        <span
          className="sb-today-row-pill"
          style={{
            color: pill.text,
            background: pill.bg,
            borderColor: urgency === URGENCY.NEUTRAL ? 'var(--sb-border)' : 'transparent',
          }}
        >
          {pillLabel}
        </span>
      </div>

      <div className="sb-today-row-owner">{ownerInitials}</div>
    </button>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-today-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 160px 130px 48px;
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
  .sb-today-row:last-child {
    border-bottom: none;
  }
  .sb-today-row:hover {
    background: var(--sb-surface-muted) !important;
  }
  .sb-today-row:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: -2px;
  }

  .sb-today-row-body {
    min-width: 0;
  }
  /* Primary line — verb-phrase. Lifted from the JobsQueueRow body type (15px,
     weight 500) so both surfaces feel like one design system. Letter-spacing
     tightens slightly the same way the queue rows do. Promise badge sits
     inline so the operator sees verb + 🤡 + promiser in one read. */
  .sb-today-row-primary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
    min-width: 0;
  }
  .sb-today-row-primary > span:first-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  /* Secondary line — identity anchor. 12px so it visibly subordinates to the
     primary, but still readable as a confirmation glance. */
  .sb-today-row-secondary {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-top: 3px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* Divergence line — surfaces ONLY when the customer promise and the
     system projection differ by 2+ days. Calm by default (neutral tone);
     amber/red when the divergence is genuinely alarming. Same 12px tier
     as the secondary so the row's vertical rhythm stays orderly. */
  .sb-today-row-divergence {
    font-size: 12px;
    color: var(--sb-text-secondary);
    margin-top: 3px;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  .sb-today-row-divergence-amber {
    color: var(--sb-amber, #b8842a);
  }
  .sb-today-row-divergence-red {
    color: var(--sb-red, #b54040);
    font-weight: 500;
  }

  .sb-today-row-stage-col {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .sb-today-row-chip {
    display: inline-block;
    max-width: 100%;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sb-today-row-status-col {
    display: flex;
    align-items: center;
  }
  .sb-today-row-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    border: 0.5px solid transparent;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .sb-today-row-owner {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    letter-spacing: 0.04em;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* Red rows promote the urgency without overpainting — the row tint, the
     pill, and the stage chip's ramp all read as the same warning. The primary
     verb-phrase stays the same weight; the operator reads the action, not a
     wall of red. */
  .sb-today-row-red .sb-today-row-primary {
    color: var(--sb-text);
  }

  @media (max-width: 1000px) {
    .sb-today-row {
      grid-template-columns: minmax(0, 1fr) 130px 40px;
    }
    .sb-today-row-status-col {
      display: none;
    }
  }
  @media (max-width: 720px) {
    .sb-today-row {
      grid-template-columns: minmax(0, 1fr) 110px;
      gap: 12px;
      padding: 12px 14px;
    }
    .sb-today-row-stage-col {
      display: none;
    }
    .sb-today-row-owner {
      display: none;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-today-row-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-today-row-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
