// =============================================================================
// 📚 Stonebooks — Calendar batch card
// =============================================================================
// A placed batch on a day. Used by CalendarWeek as the per-day stack item.
// Shows kind color stripe, title (or implicit "First +N"), worker, stop
// count, and running-late state. Promised stops surface a 🤡 dot tucked
// into the corner so the day-glance reading reflects the promise loud.
// =============================================================================

import { batchKindInfo, customerName } from '../../lib/stonebooksData'

export default function CalendarBatchCard({
  batch,
  hasPromise,
  onClick,
  draggable = false,
  onDragStart,
  onDragEnd,
}) {
  const kindInfo = batchKindInfo(batch.kind)
  const stops = batch.batch_jobs || []
  const status = batch.status
  const isLate = status === 'running_late'
  const isCompleted = status === 'completed'

  // Title — explicit when set; otherwise "Surname +N" from the first stop.
  const title = batch.title || _implicitTitle(stops, kindInfo)

  const cls = [
    'sb-cal-card',
    draggable ? 'sb-cal-card-draggable' : '',
    isLate ? 'sb-cal-card-late' : '',
    isCompleted ? 'sb-cal-card-completed' : '',
    hasPromise ? 'sb-cal-card-promise' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={cls}
      style={{ borderLeftColor: kindInfo.color }}
      onClick={() => onClick?.(batch)}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      {hasPromise && (
        <span className="sb-cal-card-promise-icon" aria-hidden="true">🤡</span>
      )}
      <div className="sb-cal-card-head">
        <span className="sb-cal-card-kind">{kindInfo.label}</span>
        {stops.length > 0 && (
          <span className="sb-cal-card-count">{stops.length}</span>
        )}
      </div>
      <div className="sb-cal-card-title">{title}</div>
      {batch.cemetery?.name && (
        <div className="sb-cal-card-cem">{batch.cemetery.name}</div>
      )}
      <div className="sb-cal-card-foot">
        {batch.assigned_to && (
          <span className="sb-cal-card-by">{batch.assigned_to}</span>
        )}
        {isLate && (
          <span className="sb-cal-card-late-tag">Running late</span>
        )}
        {isCompleted && (
          <span className="sb-cal-card-done-tag">Complete</span>
        )}
      </div>
    </button>
  )
}

function _implicitTitle(stops, kindInfo) {
  if (!stops || stops.length === 0) return kindInfo.label
  const firstJob = stops[0]?.job
  const surname = firstJob?.order?.primary_lastname
    || customerName(firstJob?.order?.customer)
    || kindInfo.label
  if (stops.length === 1) return surname
  return `${surname} +${stops.length - 1}`
}

const localStyles = `
  .sb-cal-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .sb-cal-card:hover {
    background: var(--sb-surface-muted);
  }
  .sb-cal-card-draggable {
    cursor: grab;
  }
  .sb-cal-card-draggable:active {
    cursor: grabbing;
  }
  .sb-cal-card-late {
    background: var(--sb-amber-bg, #fbe5b8);
    border-color: var(--sb-amber, #b8842a);
  }
  .sb-cal-card-completed {
    opacity: 0.55;
  }
  .sb-cal-card-promise {
    border-color: var(--sb-red, #b54040);
    box-shadow: 0 0 0 1px var(--sb-red, #b54040);
  }
  .sb-cal-card-promise-icon {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 14px;
    line-height: 1;
  }

  .sb-cal-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
  }
  .sb-cal-card-kind {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--sb-text-muted);
  }
  .sb-cal-card-count {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-cal-card-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Cemetery — where the crew is going. A field batch without a destination
     reads as incomplete; surfacing it on the card answers "where" without a
     drill-down. Hidden when the batch carries no cemetery (shop blocks). */
  .sb-cal-card-cem {
    font-size: 11px;
    color: var(--sb-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-cal-card-foot {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 11px;
    color: var(--sb-text-muted);
  }
  .sb-cal-card-by {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-cal-card-late-tag {
    color: var(--sb-amber, #b8842a);
    font-weight: 500;
  }
  .sb-cal-card-done-tag {
    color: var(--sb-green, #2d7a4f);
    font-weight: 500;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-cal-card-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-cal-card-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
