// =============================================================================
// 📚 Stonebooks — Scheduler Month view
// =============================================================================
// Six-week heat grid. Each day shows the count of placed batches and any
// open promises whose date lands that day. Promised days are loud — the
// whole cell goes red with the 🤡 so it can't be missed. Heavy days
// (5+ batches OR 1+ promise + 3+ batches) get an amber tint. Today is
// outlined. Click a day → drill into the week containing that day.
// =============================================================================

import { useMemo } from 'react'
import { getMonthLandscape, customerName } from '../../lib/stonebooksData'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MonthLandscape({ year, month, batches, promises, onDayClick }) {
  const cells = useMemo(
    () => getMonthLandscape({ year, month, batches, promises }),
    [year, month, batches, promises],
  )
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year:  'numeric',
  })

  return (
    <div className="sb-month-landscape">
      <div className="sb-month-head">
        <h2 className="sb-month-title">{monthLabel}</h2>
      </div>
      <div className="sb-month-weekday-row">
        {WEEKDAY_LABELS.map(w => (
          <div key={w} className="sb-month-weekday">{w}</div>
        ))}
      </div>
      <div className="sb-month-grid">
        {cells.map(cell => (
          <MonthCell key={cell.iso} cell={cell} onClick={onDayClick} />
        ))}
      </div>
    </div>
  )
}

function MonthCell({ cell, onClick }) {
  const hasPromise = cell.promiseCount > 0
  const classes = [
    'sb-month-cell',
    cell.inMonth ? '' : 'sb-month-cell-other',
    cell.isToday ? 'sb-month-cell-today' : '',
    hasPromise ? 'sb-month-cell-promise' : '',
    cell.heavy && !hasPromise ? 'sb-month-cell-heavy' : '',
  ].filter(Boolean).join(' ')

  // Pull a short promiser/customer summary so the cell carries the operative
  // signal even at this density. We surface only the first promise's
  // promiser + customer; an "+N more" tail covers overflow.
  const firstPromise = cell.promises[0]
  const promiserName = firstPromise?.promised_by
  const promiseSurname = firstPromise?.job?.order?.primary_lastname
    || customerName(firstPromise?.job?.order?.customer)
    || null
  const promiseOverflow = cell.promiseCount - 1

  return (
    <button
      type="button"
      className={classes}
      onClick={() => onClick?.(cell)}
    >
      <div className="sb-month-cell-head">
        <span className="sb-month-cell-day">{cell.date.getDate()}</span>
        {cell.batchCount > 0 && (
          <span className="sb-month-cell-count">{cell.batchCount}</span>
        )}
      </div>
      {hasPromise ? (
        <div className="sb-month-cell-promise-body">
          <div className="sb-month-cell-promise-row">
            <span className="sb-month-cell-promise-icon" aria-hidden="true">🤡</span>
            {promiseSurname && (
              <span className="sb-month-cell-promise-surname">{promiseSurname}</span>
            )}
          </div>
          {promiserName && (
            <div className="sb-month-cell-promise-by">{promiserName}</div>
          )}
          {promiseOverflow > 0 && (
            <div className="sb-month-cell-promise-more">
              +{promiseOverflow} more
            </div>
          )}
        </div>
      ) : cell.batchCount > 0 ? (
        <div className="sb-month-cell-dots">
          {cell.batches.slice(0, 5).map(b => (
            <span
              key={b.id}
              className="sb-month-cell-dot"
              style={{ background: _batchColor(b) }}
            />
          ))}
          {cell.batchCount > 5 && (
            <span className="sb-month-cell-dots-more">+{cell.batchCount - 5}</span>
          )}
        </div>
      ) : null}
    </button>
  )
}

// Read the batch kind color without importing batchKindInfo into every
// component — the batches the parent supplies already have `kind`.
function _batchColor(b) {
  // Map duplicated against BATCH_KINDS — purely a render-time convenience
  // to avoid an indirect import per dot. If a kind isn't in the map we
  // fall back to a neutral gray.
  const COLORS = {
    inscription:     '#534AB7',
    blasting:        '#5F5E5A',
    setting:         '#1D9E75',
    delivery:        '#1D9E75',
    acid_wash:       '#5F5E5A',
    repair:          '#D85A30',
    rub_grab:        '#5F5E5A',
    foundation_trip: '#D85A30',
    door_trip:       '#5F5E5A',
  }
  return COLORS[b.kind] || '#8b8b87'
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-month-landscape {
    width: 100%;
  }
  .sb-month-head {
    margin-bottom: 16px;
  }
  .sb-month-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .sb-month-weekday-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    margin-bottom: 4px;
  }
  .sb-month-weekday {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 8px;
  }

  .sb-month-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .sb-month-cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 88px;
    padding: 8px 10px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s, border-color 0.12s;
  }
  .sb-month-cell:hover {
    background: var(--sb-surface-muted);
  }
  .sb-month-cell:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 1px;
  }
  .sb-month-cell-other {
    background: transparent;
    opacity: 0.45;
  }
  .sb-month-cell-today {
    border-color: var(--sb-accent, #b8842a);
    box-shadow: inset 0 0 0 1px var(--sb-accent, #b8842a);
  }
  /* Heavy-day amber tint — gentle warning that the day is loaded. */
  .sb-month-cell-heavy {
    background: var(--sb-amber-bg, #fbe5b8);
    border-color: var(--sb-amber, #b8842a);
  }
  /* Promise-day red treatment — loud on purpose. The cell is a call-out.
     Today + promise together combine: the accent outline reads on the red
     background, no special handling needed. */
  .sb-month-cell-promise {
    background: var(--sb-red-bg, #fbe5e5);
    border-color: var(--sb-red, #b54040);
  }

  .sb-month-cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
  }
  .sb-month-cell-day {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
  }
  .sb-month-cell-count {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* Dot row — up to 5 dots, then +N overflow. Dots are tiny so they
     don't overwhelm the cell at the high cell density. */
  .sb-month-cell-dots {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .sb-month-cell-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 999px;
  }
  .sb-month-cell-dots-more {
    font-size: 10px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .sb-month-cell-promise-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }
  .sb-month-cell-promise-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sb-month-cell-promise-icon {
    font-size: 13px;
    line-height: 1;
  }
  .sb-month-cell-promise-surname {
    font-size: 12px;
    font-weight: 600;
    color: var(--sb-red, #b54040);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-month-cell-promise-by {
    font-size: 10px;
    color: var(--sb-red, #b54040);
    opacity: 0.85;
  }
  .sb-month-cell-promise-more {
    font-size: 10px;
    color: var(--sb-red, #b54040);
    font-weight: 500;
  }

  @media (max-width: 720px) {
    .sb-month-cell {
      min-height: 64px;
      padding: 6px 6px;
    }
    .sb-month-cell-day {
      font-size: 12px;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-month-landscape-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-month-landscape-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
