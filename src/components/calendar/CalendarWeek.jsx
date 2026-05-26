// =============================================================================
// 📚 Stonebooks — Calendar Week view
// =============================================================================
// 5 or 7 day columns, placed batches stacked per day. Day headers are
// draggable; dragging one onto another opens a confirmation modal and on
// confirm swaps every batch between the two days (the rain-day flip).
//
// Click a batch card → drill into Day view focused on that batch's date.
// =============================================================================

import { useMemo, useState } from 'react'
import { getDayRange, fmtDate, swapBatchDays } from '../../lib/stonebooksData'
import CalendarBatchCard from './CalendarBatchCard'
import WeatherStrip from './WeatherStrip'

export default function CalendarWeek({
  startDate,
  spanDays = 7,
  batches,
  promises,
  promisesByJob,
  onBatchClick,
  onReload,
}) {
  const cells = useMemo(
    () => getDayRange({ start: startDate, spanDays, batches, promises }),
    [startDate, spanDays, batches, promises],
  )
  const [dragSrcISO, setDragSrcISO] = useState(null)
  const [swapPending, setSwapPending] = useState(null)   // { fromISO, toISO, fromCount, toCount }
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState(null)

  const handleDragStart = (iso) => () => setDragSrcISO(iso)
  const handleDragOver = (iso) => (e) => {
    if (!dragSrcISO || dragSrcISO === iso) return
    e.preventDefault()
  }
  const handleDrop = (iso) => (e) => {
    e.preventDefault()
    if (!dragSrcISO || dragSrcISO === iso) {
      setDragSrcISO(null)
      return
    }
    const fromCell = cells.find(c => c.iso === dragSrcISO)
    const toCell = cells.find(c => c.iso === iso)
    setSwapPending({
      fromISO:   dragSrcISO,
      toISO:     iso,
      fromCount: fromCell?.batches.length || 0,
      toCount:   toCell?.batches.length || 0,
    })
    setDragSrcISO(null)
  }

  const confirmSwap = async () => {
    if (!swapPending) return
    setSwapping(true)
    setSwapError(null)
    const res = await swapBatchDays(swapPending.fromISO, swapPending.toISO)
    setSwapping(false)
    if (!res.ok) {
      setSwapError(res.error || 'Failed to swap days.')
      return
    }
    setSwapPending(null)
    onReload?.()
  }

  return (
    <div className="sb-cal-week">
      <div className="sb-cal-week-grid" style={{ gridTemplateColumns: `repeat(${spanDays}, minmax(0, 1fr))` }}>
        {cells.map(cell => {
          const isDragSrc = dragSrcISO === cell.iso
          const cls = [
            'sb-cal-week-col',
            cell.isToday ? 'sb-cal-week-col-today' : '',
            cell.heavy ? 'sb-cal-week-col-heavy' : '',
            isDragSrc ? 'sb-cal-week-col-dragging' : '',
          ].filter(Boolean).join(' ')
          const dayName = cell.date.toLocaleDateString('en-US', { weekday: 'short' })
          const monthDay = cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          return (
            <div key={cell.iso} className={cls}>
              <div
                className="sb-cal-week-head"
                draggable
                onDragStart={handleDragStart(cell.iso)}
                onDragOver={handleDragOver(cell.iso)}
                onDrop={handleDrop(cell.iso)}
                title="Drag onto another day to swap"
              >
                <span className="sb-cal-week-head-grip" aria-hidden="true">⠿</span>
                <span className="sb-cal-week-head-day">{dayName}</span>
                <span className="sb-cal-week-head-date">{monthDay}</span>
                {cell.batches.length >= 5 && (
                  <span className="sb-cal-week-head-heavy">Heavy</span>
                )}
                <WeatherStrip date={cell.date} variant="week" />
              </div>
              <div
                className="sb-cal-week-stack"
                onDragOver={handleDragOver(cell.iso)}
                onDrop={handleDrop(cell.iso)}
              >
                {cell.batches.length === 0 ? (
                  <div className="sb-cal-week-empty">No batches.</div>
                ) : cell.batches.map(b => (
                  <CalendarBatchCard
                    key={b.id}
                    batch={b}
                    hasPromise={_batchHasPromise(b, promisesByJob)}
                    onClick={() => onBatchClick?.(b)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {swapPending && (
        <DaySwapModal
          pending={swapPending}
          submitting={swapping}
          error={swapError}
          onCancel={() => { setSwapPending(null); setSwapError(null) }}
          onConfirm={confirmSwap}
        />
      )}
    </div>
  )
}

// True when any stop in the batch belongs to a job that has an open
// promise. Drives the loud red treatment on the card.
function _batchHasPromise(batch, promisesByJob) {
  if (!promisesByJob) return false
  for (const link of (batch.batch_jobs || [])) {
    if (promisesByJob.has(link.job_id)) return true
  }
  return false
}

function DaySwapModal({ pending, submitting, error, onCancel, onConfirm }) {
  const fromLabel = fmtDate(pending.fromISO)
  const toLabel = fmtDate(pending.toISO)
  const fromDay = new Date(`${pending.fromISO}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
  const toDay = new Date(`${pending.toISO}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
  return (
    <div className="sb-cal-swap-backdrop" onClick={onCancel}>
      <div
        className="sb-cal-swap"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm day swap"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="sb-cal-swap-title">
          Swap {fromDay} {fromLabel} and {toDay} {toLabel}?
        </h3>
        <p className="sb-cal-swap-body">
          This moves {pending.fromCount} {pending.fromCount === 1 ? 'batch' : 'batches'} from
          {' '}{fromDay} to {toDay} and {pending.toCount} {pending.toCount === 1 ? 'batch' : 'batches'} from
          {' '}{toDay} to {fromDay}.
        </p>
        {error && <div className="sb-cal-swap-error">{error}</div>}
        <div className="sb-cal-swap-actions">
          <button
            type="button"
            className="sb-cal-swap-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sb-cal-swap-confirm"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? 'Swapping…' : 'Swap days'}
          </button>
        </div>
      </div>
    </div>
  )
}

const localStyles = `
  .sb-cal-week {
    width: 100%;
  }
  .sb-cal-week-grid {
    display: grid;
    gap: 6px;
  }
  .sb-cal-week-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 280px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    padding: 8px;
  }
  .sb-cal-week-col-today {
    border-color: var(--sb-accent, #b8842a);
    box-shadow: inset 0 0 0 1px var(--sb-accent, #b8842a);
  }
  .sb-cal-week-col-heavy {
    background: var(--sb-amber-bg, #fbe5b8);
  }
  .sb-cal-week-col-dragging {
    opacity: 0.5;
  }
  .sb-cal-week-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px 8px;
    border-bottom: 0.5px solid var(--sb-border);
    cursor: grab;
    user-select: none;
    flex-wrap: wrap;
  }
  .sb-cal-week-head:active {
    cursor: grabbing;
  }
  /* Drag handle — quiet by default, becomes more visible on hover so the
     swap-day affordance is discoverable. */
  .sb-cal-week-head-grip {
    font-size: 12px;
    color: var(--sb-text-muted);
    line-height: 1;
    opacity: 0.5;
    transition: opacity 0.12s;
  }
  .sb-cal-week-head:hover .sb-cal-week-head-grip {
    opacity: 1;
    color: var(--sb-text);
  }
  .sb-cal-week-head-day {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-cal-week-head-date {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
  }
  .sb-cal-week-head-heavy {
    font-size: 10px;
    color: var(--sb-amber, #b8842a);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-left: auto;
  }
  .sb-cal-week-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 50px;
  }
  .sb-cal-week-empty {
    font-size: 11px;
    color: var(--sb-text-muted);
    padding: 6px 4px;
    font-style: italic;
  }

  /* Swap confirmation modal */
  .sb-cal-swap-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .sb-cal-swap {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    max-width: 480px;
    padding: 28px 32px 24px;
  }
  .sb-cal-swap-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 12px;
    letter-spacing: -0.005em;
  }
  .sb-cal-swap-body {
    font-size: 14px;
    line-height: 1.5;
    color: var(--sb-text-secondary);
    margin: 0 0 20px;
  }
  .sb-cal-swap-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    margin-bottom: 16px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-cal-swap-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sb-cal-swap-cancel,
  .sb-cal-swap-confirm {
    font: inherit;
    font-size: 14px;
    padding: 8px 18px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-cal-swap-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-cal-swap-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-cal-swap-confirm {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-cal-swap-confirm:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-cal-swap-cancel:disabled,
  .sb-cal-swap-confirm:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-cal-week-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-cal-week-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
