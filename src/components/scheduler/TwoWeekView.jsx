// =============================================================================
// 📚 Stonebooks — Scheduler 2-Week view
// =============================================================================
// 14-day strategic grid — two rows of seven. Each day shows placed batches
// as small chips (kind color + first surname + worker initials) so the
// operator can read load + assignment at a glance without entering Day view.
// Click a chip → open batch detail; click a day header → drill into Week.
// =============================================================================

import { useMemo } from 'react'
import { getDayRange, customerName } from '../../lib/stonebooksData'
import PromiseBadge from './PromiseBadge'

export default function TwoWeekView({ startDate, batches, promises, onDayClick, onBatchClick }) {
  const cells = useMemo(
    () => getDayRange({ start: startDate, spanDays: 14, batches, promises }),
    [startDate, batches, promises],
  )
  return (
    <div className="sb-twoweek">
      {cells.map(cell => (
        <TwoWeekCell
          key={cell.iso}
          cell={cell}
          onDayClick={onDayClick}
          onBatchClick={onBatchClick}
        />
      ))}
    </div>
  )
}

function TwoWeekCell({ cell, onDayClick, onBatchClick }) {
  const hasPromise = cell.promises.length > 0
  const classes = [
    'sb-twoweek-cell',
    cell.isToday ? 'sb-twoweek-cell-today' : '',
    hasPromise ? 'sb-twoweek-cell-promise' : '',
    cell.heavy && !hasPromise ? 'sb-twoweek-cell-heavy' : '',
  ].filter(Boolean).join(' ')
  const dayLabel = cell.date.toLocaleDateString('en-US', { weekday: 'short' })
  const dayNum = cell.date.getDate()

  return (
    <div className={classes}>
      <button
        type="button"
        className="sb-twoweek-cell-head"
        onClick={() => onDayClick?.(cell)}
      >
        <span className="sb-twoweek-cell-day">{dayLabel}</span>
        <span className="sb-twoweek-cell-date">{dayNum}</span>
      </button>
      {hasPromise && (
        <div className="sb-twoweek-cell-promises">
          {cell.promises.slice(0, 2).map(p => (
            <PromiseBadge key={p.id} promise={p} size="sm" />
          ))}
          {cell.promises.length > 2 && (
            <span className="sb-twoweek-cell-more">+{cell.promises.length - 2}</span>
          )}
        </div>
      )}
      <div className="sb-twoweek-cell-batches">
        {cell.batches.slice(0, 4).map(b => (
          <button
            key={b.id}
            type="button"
            className="sb-twoweek-batch-chip"
            onClick={() => onBatchClick?.(b)}
            style={{ borderLeftColor: _kindColor(b.kind) }}
          >
            <span className="sb-twoweek-batch-chip-label">
              {_batchLabel(b)}
            </span>
            {b.assigned_to && (
              <span className="sb-twoweek-batch-chip-by">{b.assigned_to}</span>
            )}
          </button>
        ))}
        {cell.batches.length > 4 && (
          <div className="sb-twoweek-cell-more">
            +{cell.batches.length - 4} more
          </div>
        )}
      </div>
    </div>
  )
}

function _batchLabel(b) {
  if (b.title) return b.title
  // Default — first stop's surname + count. The user doesn't usually title
  // batches; the title is "Smith + 2" or similar implicit summary.
  const stops = b.batch_jobs || []
  if (stops.length === 0) return _kindLabel(b.kind)
  const firstJob = stops[0]?.job
  const surname = firstJob?.order?.primary_lastname || customerName(firstJob?.order?.customer) || _kindLabel(b.kind)
  if (stops.length === 1) return surname
  return `${surname} +${stops.length - 1}`
}

function _kindColor(kind) {
  const COLORS = {
    inscription: '#534AB7', blasting: '#5F5E5A', setting: '#1D9E75',
    delivery: '#1D9E75', acid_wash: '#5F5E5A', repair: '#D85A30',
    rub_grab: '#5F5E5A', foundation_trip: '#D85A30', door_trip: '#5F5E5A',
  }
  return COLORS[kind] || '#8b8b87'
}
function _kindLabel(kind) {
  const LABELS = {
    inscription: 'Inscriptions', blasting: 'Blasting', setting: 'Setting',
    delivery: 'Delivery', acid_wash: 'Acid wash', repair: 'Repair',
    rub_grab: 'Rub-grab', foundation_trip: 'Foundation', door_trip: 'Doors',
  }
  return LABELS[kind] || kind
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-twoweek {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .sb-twoweek-cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 140px;
    padding: 8px 8px 10px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-twoweek-cell-today {
    border-color: var(--sb-accent, #b8842a);
    box-shadow: inset 0 0 0 1px var(--sb-accent, #b8842a);
  }
  .sb-twoweek-cell-heavy {
    background: var(--sb-amber-bg, #fbe5b8);
  }
  .sb-twoweek-cell-promise {
    background: var(--sb-red-bg, #fbe5e5);
    border-color: var(--sb-red, #b54040);
  }
  .sb-twoweek-cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .sb-twoweek-cell-day {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-twoweek-cell-date {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
  }

  .sb-twoweek-cell-promises {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .sb-twoweek-cell-batches {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sb-twoweek-batch-chip {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    background: transparent;
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }
  .sb-twoweek-batch-chip:hover {
    background: var(--sb-surface-muted);
  }
  .sb-twoweek-batch-chip-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-twoweek-batch-chip-by {
    font-size: 10px;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-twoweek-cell-more {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-twoweek-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-twoweek-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
