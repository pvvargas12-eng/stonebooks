// =============================================================================
// 📚 Stonebooks — Calendar Day dispatch sheet
// =============================================================================
// The dispatch surface for a single field batch on a given day. Shows the
// trip header (worker, mileage, estimated time), each stop with its die /
// color / top spec, the per-stop completion checkbox, and a stop-reorder
// drag handle. Promised stops carry the 🤡 badge inline.
//
// Running late toggle in the header lets the crew chief flip the batch
// status without leaving the dispatch sheet.
// =============================================================================

import { useState, useCallback } from 'react'
import {
  batchKindInfo,
  customerName,
  fmtDate,
  markBatchJobComplete,
  markBatchInProgress,
  markBatchRunningLate,
  reorderBatchStops,
} from '../../lib/stonebooksData'
import PromiseBadge from '../scheduler/PromiseBadge'

export default function CalendarDayDispatch({ batch, promisesByJob, actorName, actorUserId, onCascadeWarning, onRequestUnmark, onUnschedule, onCompleted, onReload }) {
  const [busyStopId, setBusyStopId] = useState(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [error, setError] = useState(null)
  const [dragSrcJobId, setDragSrcJobId] = useState(null)

  const kindInfo = batchKindInfo(batch.kind)
  const stops = batch.stops || []
  const mileage = batch.mileage || { total_miles: 0, estimated_minutes: 0, leg_miles: [] }
  const isLate = batch.status === 'running_late'

  const handleToggleStop = async (stop) => {
    // ITEM 3 — a completed stop routes to the unmark-confirm flow (owned by
    // CalendarDay) instead of being an inert no-op.
    if (stop.completed_at) { onRequestUnmark?.(stop); return }
    setBusyStopId(stop.id)
    setError(null)
    // Bug #1 fix: cascadeWarning state now lives on CalendarTab (this
    // component unmounts during the loading cycle after onReload, so local
    // state was being destroyed before render). Push the warning up; reset
    // on entry so a fresh tick doesn't render the previous warning.
    onCascadeWarning?.(null)
    const res = await markBatchJobComplete(stop.id, { actorName, actorUserId })
    setBusyStopId(null)
    if (!res.ok) {
      setError(res.error || 'Failed to mark complete.')
      return
    }
    if (res.warning) onCascadeWarning?.(res.warning)
    // ITEM 4 — offer a completion-photo box for photo-required kinds. Fires
    // before reload so the just-completed stop (with its order join) is read
    // from the current props snapshot.
    onCompleted?.(stop, kindInfo)
    onReload?.()
  }

  const handleRunningLate = async () => {
    setStatusBusy(true)
    setError(null)
    const res = isLate
      ? await markBatchInProgress(batch.id)
      : await markBatchRunningLate(batch.id)
    setStatusBusy(false)
    if (!res.ok) {
      setError(res.error || 'Failed to update status.')
      return
    }
    onReload?.()
  }

  // Drag reorder — pure HTML5 d&d. Drop on a stop bumps that stop's order
  // ahead of the drop target. Order persists via reorderBatchStops.
  const handleDragStart = (jobId) => () => setDragSrcJobId(jobId)
  const handleDragOver = (e) => { if (dragSrcJobId) e.preventDefault() }
  const handleDrop = useCallback((targetJobId) => async (e) => {
    e.preventDefault()
    if (!dragSrcJobId || dragSrcJobId === targetJobId) {
      setDragSrcJobId(null)
      return
    }
    const ordered = stops.map(s => s.job_id).filter(id => id !== dragSrcJobId)
    const targetIdx = ordered.indexOf(targetJobId)
    if (targetIdx < 0) {
      setDragSrcJobId(null)
      return
    }
    ordered.splice(targetIdx, 0, dragSrcJobId)
    setDragSrcJobId(null)
    setError(null)
    const res = await reorderBatchStops(batch.id, ordered)
    if (!res.ok) {
      setError(res.error || 'Failed to reorder.')
      return
    }
    onReload?.()
  }, [batch.id, dragSrcJobId, stops, onReload])

  return (
    <article
      className={`sb-dispatch ${isLate ? 'sb-dispatch-late' : ''}`}
      style={{ borderLeftColor: kindInfo.color }}
    >
      <header className="sb-dispatch-head">
        <div className="sb-dispatch-head-left">
          <span className="sb-dispatch-kind">{kindInfo.label}</span>
          <span className="sb-dispatch-title">
            {batch.title || _implicitTitle(stops, kindInfo)}
          </span>
        </div>
        <div className="sb-dispatch-head-right">
          {batch.assigned_to && (
            <span className="sb-dispatch-assigned">{batch.assigned_to}</span>
          )}
          {kindInfo.isField && (
            <span className="sb-dispatch-mileage">
              {mileage.total_miles > 0
                ? `${mileage.total_miles} mi · ${_fmtMinutes(mileage.estimated_minutes)}`
                : 'Mileage TBD'}
            </span>
          )}
          <button
            type="button"
            className={`sb-dispatch-late-toggle ${isLate ? 'sb-dispatch-late-toggle-on' : ''}`}
            onClick={handleRunningLate}
            disabled={statusBusy}
          >
            {isLate ? 'Running late ✓' : 'Mark running late'}
          </button>
          {onUnschedule && (
            <button
              type="button"
              className="sb-dispatch-unschedule"
              onClick={() => onUnschedule(batch)}
              title="Unschedule — back to Ready to schedule"
            >
              Unschedule
            </button>
          )}
        </div>
      </header>

      {batch.notes && (
        <div className="sb-dispatch-notes">{batch.notes}</div>
      )}

      {error && (
        <div className="sb-dispatch-error">{error}</div>
      )}
      {/* (M) cascade warning now lives at CalendarTab level so it survives
          the loading-unmount cycle. See Bug #1 fix on CalendarTab. */}

      {/* Zero-stop batches are ad-hoc events (site_visit / errand) — their
          operational content lives entirely in the title + notes, so the
          stops list is suppressed instead of rendering an "empty" message
          that misreads as "something's wrong." */}
      {stops.length === 0 ? null : (
      <ol className="sb-dispatch-stops">
        {stops.map((stop, idx) => {
          const job = stop.job
          const surname = job?.order?.primary_lastname || customerName(job?.order?.customer) || '—'
          const cem = batch.cemetery?.name || job?.order?.cemetery?.name || job?.cemetery?.name
          const isDone = !!stop.completed_at
          const isBusy = busyStopId === stop.id
          const promises = promisesByJob?.get(job?.id) || []
          const dieSpec = _dieSpec(job?.order)
          const baseSpec = _baseSpec(job?.order)
          const color = job?.order?.granite_color || job?.order?.graniteColor || null
          const topShape = job?.order?.shape || null
          return (
            <li
              key={stop.id}
              className={`sb-dispatch-stop ${isDone ? 'sb-dispatch-stop-done' : ''}`}
              draggable={!isDone}
              onDragStart={handleDragStart(stop.job_id)}
              onDragOver={handleDragOver}
              onDrop={handleDrop(stop.job_id)}
            >
              <span className="sb-dispatch-stop-handle" aria-hidden="true">⠿</span>
              <input
                type="checkbox"
                className="sb-dispatch-stop-check"
                checked={isDone}
                onChange={() => handleToggleStop(stop)}
                disabled={isBusy}
                aria-label={isDone ? `Unmark ${surname} complete` : `Mark ${surname} complete`}
              />
              <div className="sb-dispatch-stop-body">
                <div className="sb-dispatch-stop-primary">
                  <span className="sb-dispatch-stop-num">{idx + 1}.</span>
                  <span className="sb-dispatch-stop-name">{surname}</span>
                  {stop.carry_over_from && (
                    <span className="sb-dispatch-stop-carry">carried over</span>
                  )}
                  {promises.length > 0 && (
                    <PromiseBadge promise={promises[0]} size="sm" />
                  )}
                </div>
                <div className="sb-dispatch-stop-spec">
                  {[
                    dieSpec  && `die ${dieSpec}`,
                    baseSpec && `base ${baseSpec}`,
                    color    && color,
                    topShape && topShape,
                  ].filter(Boolean).join(' · ') || 'Spec details pending'}
                </div>
                {cem && idx === 0 && (
                  <div className="sb-dispatch-stop-cem">{cem}</div>
                )}
                {isDone && (
                  <div className="sb-dispatch-stop-done-tag">
                    {stop.completed_by
                      ? `Complete · ${stop.completed_by} · ${fmtDate(stop.completed_at)}`
                      : `Complete · ${fmtDate(stop.completed_at)}`}
                    <button
                      type="button"
                      className="sb-dispatch-stop-unmark"
                      onClick={() => onRequestUnmark?.(stop)}
                      title="Unmark complete"
                    >
                      unmark
                    </button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      )}
    </article>
  )
}

function _implicitTitle(stops, kindInfo) {
  if (!stops || stops.length === 0) return kindInfo.label
  const firstJob = stops[0]?.job
  const surname = firstJob?.order?.primary_lastname || customerName(firstJob?.order?.customer) || kindInfo.label
  if (stops.length === 1) return surname
  return `${surname} +${stops.length - 1}`
}

function _dieSpec(order) {
  const c = order?.die_config || order?.dieConfig
  if (!c) return null
  const w = c.width || c.w
  const h = c.height || c.h
  const d = c.depth || c.d
  if (!w || !h) return null
  return d ? `${w}×${h}×${d}` : `${w}×${h}`
}
function _baseSpec(order) {
  const c = order?.base_config || order?.baseConfig
  if (!c) return null
  const w = c.width || c.w
  const h = c.height || c.h
  const d = c.depth || c.d
  if (!w || !h) return null
  return d ? `${w}×${h}×${d}` : `${w}×${h}`
}
function _fmtMinutes(mins) {
  if (!mins || mins <= 0) return '0 min'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const localStyles = `
  .sb-dispatch {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-left: 4px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    padding: 14px 16px;
    margin-bottom: 16px;
  }
  .sb-dispatch-late {
    background: var(--sb-amber-bg, #fbe5b8);
    border-color: var(--sb-amber, #b8842a);
  }
  .sb-dispatch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 0.5px solid var(--sb-border);
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .sb-dispatch-head-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sb-dispatch-kind {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--sb-text-muted);
  }
  .sb-dispatch-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-dispatch-head-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .sb-dispatch-assigned {
    font-size: 11px;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-dispatch-mileage {
    font-size: 12px;
    color: var(--sb-text);
    font-variant-numeric: tabular-nums;
    padding: 2px 8px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-dispatch-late-toggle {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
  }
  .sb-dispatch-late-toggle:hover:not(:disabled) {
    background: var(--sb-surface-muted);
    color: var(--sb-text);
  }
  .sb-dispatch-late-toggle-on {
    background: var(--sb-amber, #b8842a);
    border-color: var(--sb-amber, #b8842a);
    color: white;
  }
  .sb-dispatch-unschedule {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
  }
  .sb-dispatch-unschedule:hover {
    color: var(--sb-red, #b54040);
    border-color: var(--sb-red, #b54040);
    background: var(--sb-red-bg, #fbe5e5);
  }

  .sb-dispatch-notes {
    font-size: 12px;
    color: var(--sb-text-secondary);
    font-style: italic;
    padding: 6px 0 10px;
    border-bottom: 0.5px solid var(--sb-border);
    margin-bottom: 10px;
  }
  .sb-dispatch-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
    margin-bottom: 10px;
  }
  /* (M) cascade warning styles relocated to CalendarTab.jsx — banner lives
     at the tab level now to survive the loading-unmount cycle (Bug #1). */

  .sb-dispatch-stops {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sb-dispatch-stops-empty {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-style: italic;
    padding: 4px;
  }
  .sb-dispatch-stop {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    background: var(--sb-surface-muted);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-dispatch-stop-done {
    opacity: 0.55;
  }
  .sb-dispatch-stop-handle {
    color: var(--sb-text-muted);
    cursor: grab;
    user-select: none;
    font-size: 14px;
    padding-top: 2px;
  }
  .sb-dispatch-stop-handle:active {
    cursor: grabbing;
  }
  .sb-dispatch-stop-check {
    margin-top: 4px;
    accent-color: var(--sb-accent, #b8842a);
    cursor: pointer;
  }
  .sb-dispatch-stop-body {
    flex: 1;
    min-width: 0;
  }
  .sb-dispatch-stop-primary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sb-dispatch-stop-num {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
  }
  .sb-dispatch-stop-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-dispatch-stop-carry {
    font-size: 10px;
    color: var(--sb-amber, #b8842a);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border: 0.5px solid var(--sb-amber, #b8842a);
    border-radius: 999px;
  }
  .sb-dispatch-stop-spec {
    font-size: 13px;
    color: var(--sb-text-secondary);
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
    line-height: 1.45;
  }
  .sb-dispatch-stop-cem {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 4px;
    font-style: italic;
  }
  .sb-dispatch-stop-done-tag {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--sb-green, #2d7a4f);
    margin-top: 4px;
  }
  .sb-dispatch-stop-unmark {
    font: inherit;
    font-size: 11px;
    color: var(--sb-text-muted);
    background: transparent;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    padding: 1px 7px;
    cursor: pointer;
  }
  .sb-dispatch-stop-unmark:hover {
    color: var(--sb-red, #b54040);
    border-color: var(--sb-red, #b54040);
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-dispatch-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-dispatch-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
