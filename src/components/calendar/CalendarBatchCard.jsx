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
  onUnschedule,
  overdue = false,
  overdueDate = null,
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
    overdue ? 'sb-cal-card-overdue' : '',
  ].filter(Boolean).join(' ')

  return (
    // Wrapper so the unschedule control is a sibling of the main button, never
    // a nested <button> (invalid DOM). The wrapper carries the drag so grabbing
    // anywhere but the ✕ starts a reschedule drag.
    <div
      className="sb-cal-card-wrap"
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <button
        type="button"
        className={cls}
        style={{ borderLeftColor: kindInfo.color }}
        onClick={() => onClick?.(batch)}
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
        {overdue && (
          <div className="sb-cal-card-overdue-line">
            <span className="sb-cal-card-overdue-tag">Overdue</span>
            {overdueDate && (
              <span className="sb-cal-card-overdue-when">Was scheduled for {overdueDate}</span>
            )}
          </div>
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
      {onUnschedule && (
        <button
          type="button"
          className="sb-cal-card-unschedule"
          title="Unschedule — back to Ready to schedule"
          aria-label="Unschedule"
          onClick={(e) => { e.stopPropagation(); onUnschedule(batch) }}
        >
          ✕
        </button>
      )}
    </div>
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
  .sb-cal-card-wrap {
    position: relative;
    width: 100%;
  }
  /* Unschedule control — sits in the top-right of the card, sibling (not child)
     of the main button to keep the DOM valid. Quiet until hover so it doesn't
     compete with the card content. */
  .sb-cal-card-unschedule {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font: inherit;
    font-size: 11px;
    line-height: 1;
    color: var(--sb-text-muted);
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
    z-index: 2;
  }
  .sb-cal-card-wrap:hover .sb-cal-card-unschedule,
  .sb-cal-card-unschedule:focus-visible {
    opacity: 1;
  }
  .sb-cal-card-unschedule:hover {
    color: var(--sb-red, #b54040);
    border-color: var(--sb-red, #b54040);
    background: var(--sb-red-bg, #fbe5e5);
  }
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
  /* Overdue (derived: past + unfinished). Red left edge + soft wash so it reads
     as needing attention while it sits in the Ready-to-schedule tray. */
  .sb-cal-card-overdue {
    background: var(--sb-red-bg, #fbe5e5);
    border-color: var(--sb-red, #b54040);
  }
  .sb-cal-card-overdue-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-cal-card-overdue-tag {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #fff;
    background: var(--sb-red, #b54040);
    padding: 1px 6px;
    border-radius: 999px;
  }
  .sb-cal-card-overdue-when {
    font-size: 11px;
    color: var(--sb-red, #b54040);
    font-style: italic;
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
