// =============================================================================
// 📚 Stonebooks — Calendar Day view
// =============================================================================
// The crew chief's surface. Two columns at desktop widths:
//   • In the field — every batch with isField=true. Renders as full
//     dispatch sheets via CalendarDayDispatch.
//   • In the shop  — every batch with isField=false. Renders as a quieter
//     shop block: title, worker, stops list, notes.
//
// The carryover banner sits at the very top — yesterday's unfinished work.
// A summary footer rolls up the day's totals (stones, promises, workers).
// =============================================================================

import { useMemo } from 'react'
import {
  batchKindInfo,
  customerName,
  getDayView,
} from '../../lib/stonebooksData'
import PromiseBadge from '../scheduler/PromiseBadge'
import CarryoverBanner from './CarryoverBanner'
import CalendarDayDispatch from './CalendarDayDispatch'

export default function CalendarDay({
  date,
  batches,
  carryover,
  promisesByJob,
  actorName,
  onReload,
}) {
  const view = useMemo(
    () => getDayView({ date, batches }),
    [date, batches],
  )

  // Summary footer numbers.
  const totalStops =
    view.field.reduce((sum, b) => sum + (b.stops?.length || 0), 0) +
    view.shop.reduce((sum, b) => sum + (b.stops?.length || 0), 0)
  const promisedStops = (() => {
    let n = 0
    for (const b of [...view.field, ...view.shop]) {
      for (const s of (b.stops || [])) {
        if (promisesByJob?.has(s.job_id)) n += 1
      }
    }
    return n
  })()
  const workersOut = new Set()
  for (const b of view.field) {
    if (b.assigned_to) workersOut.add(b.assigned_to)
  }

  return (
    <div className="sb-cal-day">
      <CarryoverBanner
        rows={carryover}
        actorName={actorName}
        onReload={onReload}
      />

      <div className="sb-cal-day-grid">
        <section className="sb-cal-day-col">
          <header className="sb-cal-day-col-head">
            <span className="sb-cal-day-col-label">In the field</span>
            <span className="sb-cal-day-col-count">{view.field.length}</span>
          </header>
          {view.field.length === 0 ? (
            <div className="sb-cal-day-empty">No field trips scheduled.</div>
          ) : view.field.map(b => (
            <CalendarDayDispatch
              key={b.id}
              batch={b}
              promisesByJob={promisesByJob}
              actorName={actorName}
              onReload={onReload}
            />
          ))}
        </section>

        <section className="sb-cal-day-col">
          <header className="sb-cal-day-col-head">
            <span className="sb-cal-day-col-label">In the shop</span>
            <span className="sb-cal-day-col-count">{view.shop.length}</span>
          </header>
          {view.shop.length === 0 ? (
            <div className="sb-cal-day-empty">No shop work scheduled.</div>
          ) : view.shop.map(b => (
            <ShopBatchBlock
              key={b.id}
              batch={b}
              promisesByJob={promisesByJob}
            />
          ))}
        </section>
      </div>

      <footer className="sb-cal-day-foot">
        <span>{totalStops} {totalStops === 1 ? 'stop' : 'stops'} today</span>
        {promisedStops > 0 && (
          <span className="sb-cal-day-foot-promise">
            🤡 {promisedStops} promised
          </span>
        )}
        {workersOut.size > 0 && (
          <span>{workersOut.size} {workersOut.size === 1 ? 'worker out' : 'workers out'}: {Array.from(workersOut).join(', ')}</span>
        )}
      </footer>
    </div>
  )
}

// Shop-batch block — quieter than the field dispatch sheet. The crew isn't
// driving anywhere, so mileage and stop ordering don't apply. Just the
// title, the worker, the stones in the block, and any notes.
function ShopBatchBlock({ batch, promisesByJob }) {
  const kindInfo = batchKindInfo(batch.kind)
  const stops = batch.stops || []
  return (
    <article
      className="sb-cal-shop"
      style={{ borderLeftColor: kindInfo.color }}
    >
      <header className="sb-cal-shop-head">
        <span className="sb-cal-shop-kind">{kindInfo.label}</span>
        <span className="sb-cal-shop-title">
          {batch.title || `${kindInfo.label} block`}
        </span>
        {batch.assigned_to && (
          <span className="sb-cal-shop-by">{batch.assigned_to}</span>
        )}
      </header>
      {batch.notes && (
        <div className="sb-cal-shop-notes">{batch.notes}</div>
      )}
      <ul className="sb-cal-shop-stops">
        {stops.map(s => {
          const surname = s.job?.order?.primary_lastname
            || customerName(s.job?.order?.customer)
            || '—'
          const promises = promisesByJob?.get(s.job_id) || []
          return (
            <li key={s.id} className="sb-cal-shop-stop">
              <span className="sb-cal-shop-stop-name">{surname}</span>
              {promises.length > 0 && (
                <PromiseBadge promise={promises[0]} size="sm" />
              )}
              {s.completed_at && (
                <span className="sb-cal-shop-stop-done">complete</span>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}

const localStyles = `
  .sb-cal-day {
    width: 100%;
  }
  .sb-cal-day-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 24px;
  }
  .sb-cal-day-col {
    min-width: 0;
  }
  .sb-cal-day-col-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-cal-day-col-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-cal-day-col-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-cal-day-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 12px 4px;
    font-style: italic;
  }
  .sb-cal-day-foot {
    display: flex;
    gap: 18px;
    padding: 14px 16px;
    margin-top: 16px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    font-size: 13px;
    color: var(--sb-text-secondary);
    flex-wrap: wrap;
  }
  .sb-cal-day-foot-promise {
    color: var(--sb-red, #b54040);
    font-weight: 500;
  }

  .sb-cal-shop {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .sb-cal-shop-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .sb-cal-shop-kind {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--sb-text-muted);
  }
  .sb-cal-shop-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-cal-shop-by {
    margin-left: auto;
    font-size: 11px;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-cal-shop-notes {
    font-size: 12px;
    color: var(--sb-text-secondary);
    font-style: italic;
    margin-bottom: 8px;
  }
  .sb-cal-shop-stops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sb-cal-shop-stop {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    border-top: 0.5px solid var(--sb-border);
    font-size: 13px;
    color: var(--sb-text);
  }
  .sb-cal-shop-stop:first-child {
    border-top: none;
  }
  .sb-cal-shop-stop-name {
    font-weight: 500;
  }
  .sb-cal-shop-stop-done {
    font-size: 11px;
    color: var(--sb-green, #2d7a4f);
    margin-left: auto;
  }

  @media (max-width: 900px) {
    .sb-cal-day-grid {
      grid-template-columns: 1fr;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-cal-day-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-cal-day-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
