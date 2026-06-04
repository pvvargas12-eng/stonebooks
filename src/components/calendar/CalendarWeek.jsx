// =============================================================================
// 📚 Stonebooks — Calendar Week view
// =============================================================================
// The dispatcher's single screen: an unscheduled TRAY strip on top, the week
// grid below. Each day column splits into three drop zones — an all-day band,
// an AM zone, and a PM zone — and existing scheduled batches render in their
// zone by `work_batches.am_pm` (NULL → all-day, 'am' → AM, 'pm' → PM).
//
// Drag idioms (native HTML5, no library — matching the day-swap + stop-reorder
// patterns already in this tab):
//   • Day HEADER drag → drop on another day → swap all batches (rain-day flip),
//     via component state `dragSrcISO` (no dataTransfer), confirmed by modal.
//   • BATCH card / tray chip drag → drop on a day zone → reschedule that batch
//     to {date, slot}, via a dataTransfer payload + `draggingBatch` state.
//     Persistence is lifted to CalendarTab through `onScheduleBatch` (updateBatch
//     + undo toast). The two drag styles are disambiguated in the zone handlers:
//     a header drag (dragSrcISO set) always routes to the swap; otherwise the
//     batch payload is read.
//
// Day cells are colored by the promise-state engine (promiseDayState.js).
// Click a batch card → drill into Day view focused on that batch's date.
// =============================================================================

import { useMemo, useState } from 'react'
import {
  getDayRange,
  fmtDate,
  swapBatchDays,
  batchKindInfo,
  customerName,
  isBatchOverdue,
  todayLocalISO,
} from '../../lib/stonebooksData'
import { computePromiseDayState } from '../../lib/promiseDayState'
import CalendarBatchCard from './CalendarBatchCard'
import WeatherStrip from './WeatherStrip'

const BATCH_MIME = 'application/x-sb-batch'
// Ready-work cards in the merged-Scheduler rail (UnscheduledColumn) drag with
// this MIME; dropping one on a day zone creates + schedules a 1-stop batch.
// Parallel to the batch-reschedule drag, disambiguated by MIME in the handlers.
const READYJOB_MIME = 'application/x-sb-readyjob'
const _hasReadyJob = (e) => {
  try { return Array.prototype.includes.call(e.dataTransfer.types || [], READYJOB_MIME) }
  catch { return false }
}

export default function CalendarWeek({
  startDate,
  spanDays = 7,
  batches,
  promises,
  promisesByJob,
  onBatchClick,
  onScheduleBatch,
  onScheduleReadyJob,
  onUnscheduleBatch,
  onDayClick,
  onReload,
}) {
  const cells = useMemo(
    () => getDayRange({ start: startDate, spanDays, batches, promises }),
    [startDate, spanDays, batches, promises],
  )

  const todayISO = todayLocalISO()

  // Overdue batches (ITEM 3): scheduled in the past + still unfinished. Derived
  // — never mutated on read. They get pulled out of their (past) day cell and
  // surfaced in the Ready-to-schedule tray flagged OVERDUE, so the dispatcher
  // re-homes them instead of losing them off the bottom of last week.
  const overdueBatches = useMemo(
    () => (batches || []).filter(b => isBatchOverdue(b, todayISO)),
    [batches, todayISO],
  )
  const overdueIds = useMemo(() => new Set(overdueBatches.map(b => b.id)), [overdueBatches])

  // Tray = overdue (worst-first feel: shown first) + genuinely unscheduled.
  // Excludes cancelled, matching the Scheduler tray's filter. No overlap:
  // overdue batches carry a scheduled_date, unscheduled ones don't.
  const trayItems = useMemo(() => {
    const unscheduled = (batches || []).filter(b => !b.scheduled_date && b.status !== 'cancelled')
    return [
      ...overdueBatches.map(b => ({ batch: b, overdue: true })),
      ...unscheduled.map(b => ({ batch: b, overdue: false })),
    ]
  }, [batches, overdueBatches])

  // Day-swap state (header drag) — unchanged from the original.
  const [dragSrcISO, setDragSrcISO] = useState(null)
  const [swapPending, setSwapPending] = useState(null)   // { fromISO, toISO, fromCount, toCount }
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState(null)

  // Batch-drag state (card / tray chip drag). Held so zone dragOver can
  // preventDefault without reading dataTransfer (which browsers restrict
  // during dragover).
  const [draggingBatch, setDraggingBatch] = useState(null)
  // The zone the cursor is currently over during a batch drag ("iso:slot").
  const [dragOverKey, setDragOverKey] = useState(null)

  // ── Day-swap handlers (header) — preserved behavior ────────────────────────
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
    try {
      const res = await swapBatchDays(swapPending.fromISO, swapPending.toISO)
      setSwapping(false)
      if (!res.ok) {
        setSwapError(res.error || "Couldn't save — try again")
        return
      }
      setSwapPending(null)
      onReload?.()
    } catch {
      setSwapping(false)
      setSwapError("Couldn't save — try again")
    }
  }

  // ── Batch-drag handlers (card / tray chip → zone) ──────────────────────────
  const handleBatchDragStart = (batch) => (e) => {
    const payload = {
      batchId:  batch.id,
      fromDate: batch.scheduled_date ? String(batch.scheduled_date).slice(0, 10) : null,
      fromSlot: batch.am_pm ?? null,
    }
    try {
      e.dataTransfer.setData(BATCH_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'move'
    } catch { /* older browsers — draggingBatch state still covers the drop */ }
    setDraggingBatch({ ...payload, label: _batchLabel(batch) })
  }
  const handleBatchDragEnd = () => { setDraggingBatch(null); setDragOverKey(null) }

  const handleZoneDragOver = (cell, slot) => (e) => {
    // A header day-swap drag takes precedence; otherwise accept a batch drag
    // OR a ready-job drag from the rail (detected by MIME — its drag started
    // in another component, so draggingBatch is null).
    if (dragSrcISO && dragSrcISO !== cell.iso) { e.preventDefault(); return }
    if (draggingBatch) { e.preventDefault(); return }
    if (_hasReadyJob(e)) {
      e.preventDefault()
      setDragOverKey(`${cell.iso}:${slot || 'allday'}`)
    }
  }
  const handleZoneDragEnter = (cell, slot) => () => {
    if (draggingBatch) setDragOverKey(`${cell.iso}:${slot || 'allday'}`)
  }
  const handleZoneDragLeave = (cell, slot) => (e) => {
    // Ignore leaves that just cross into a child element (avoids flicker).
    if (e.currentTarget.contains(e.relatedTarget)) return
    const key = `${cell.iso}:${slot || 'allday'}`
    setDragOverKey(k => (k === key ? null : k))
  }
  const handleZoneDrop = (cell, slot) => (e) => {
    e.preventDefault()
    e.stopPropagation()   // don't double-handle via the column/header drop
    setDragOverKey(null)

    // Header day-swap routed through a zone drop.
    if (dragSrcISO) {
      if (dragSrcISO !== cell.iso) {
        const fromCell = cells.find(c => c.iso === dragSrcISO)
        const toCell = cells.find(c => c.iso === cell.iso)
        setSwapPending({
          fromISO:   dragSrcISO,
          toISO:     cell.iso,
          fromCount: fromCell?.batches.length || 0,
          toCount:   toCell?.batches.length || 0,
        })
      }
      setDragSrcISO(null)
      return
    }

    // Ready-job drop from the rail → create + schedule a 1-stop batch on this
    // day/slot (handled by SchedulerTab via createBatch). MIME-disambiguated.
    let readyPayload = null
    try { readyPayload = JSON.parse(e.dataTransfer.getData(READYJOB_MIME)) } catch { /* not a ready-job drag */ }
    if (readyPayload?.jobId) {
      onScheduleReadyJob?.(readyPayload, { date: cell.iso, slot: slot || null })
      return
    }

    // Batch reschedule.
    let payload = null
    try { payload = JSON.parse(e.dataTransfer.getData(BATCH_MIME)) } catch { /* fall back to state */ }
    const db = draggingBatch
    setDraggingBatch(null)
    const batchId = payload?.batchId || db?.batchId
    if (!batchId) return
    const fromDate = payload?.fromDate ?? db?.fromDate ?? null
    const fromSlot = payload?.fromSlot ?? db?.fromSlot ?? null
    const label = db?.label || 'batch'
    // No-op if dropped back onto the same date + slot.
    if (fromDate === cell.iso && (fromSlot ?? null) === (slot ?? null)) return
    onScheduleBatch?.({ batchId, toDate: cell.iso, toSlot: slot, fromDate, fromSlot, label })
  }

  // Render one drop zone (all-day / AM / PM) within a day column.
  const renderZone = (cell, slot, label, zoneBatches) => {
    const key = `${cell.iso}:${slot || 'allday'}`
    const zcls = [
      'sb-cal-zone',
      `sb-cal-zone-${slot || 'allday'}`,
      draggingBatch ? 'sb-cal-zone--drag-active' : '',
      dragOverKey === key ? 'sb-cal-zone--drag-over' : '',
    ].filter(Boolean).join(' ')
    return (
      <div
        className={zcls}
        onDragOver={handleZoneDragOver(cell, slot)}
        onDragEnter={handleZoneDragEnter(cell, slot)}
        onDragLeave={handleZoneDragLeave(cell, slot)}
        onDrop={handleZoneDrop(cell, slot)}
      >
        <div className="sb-cal-zone-label">{label}</div>
        {zoneBatches.length === 0 ? (
          // Hint only appears mid-drag — otherwise idle zones read as quiet.
          draggingBatch ? <div className="sb-cal-zone-empty">drop here</div> : null
        ) : (
          zoneBatches.map(b => (
            <CalendarBatchCard
              key={b.id}
              batch={b}
              hasPromise={_batchHasPromise(b, promisesByJob)}
              onClick={() => onBatchClick?.(b)}
              draggable
              onDragStart={handleBatchDragStart(b)}
              onDragEnd={handleBatchDragEnd}
              onUnschedule={onUnscheduleBatch}
            />
          ))
        )}
      </div>
    )
  }

  return (
    <div className="sb-cal-week">
      {/* Ready-to-schedule tray — drag a chip down into any day zone. Overdue
          batches (past + unfinished) surface here flagged, ahead of the
          genuinely-unscheduled ones. */}
      <div className="sb-cal-tray">
        <span className="sb-cal-tray-label">Ready to schedule</span>
        {trayItems.length === 0 ? (
          <span className="sb-cal-tray-empty">Nothing waiting — all scheduled work is on the calendar.</span>
        ) : (
          <div className="sb-cal-tray-chips">
            {trayItems.map(({ batch: b, overdue }) => {
              const kindInfo = batchKindInfo(b.kind)
              const whenLabel = overdue && b.scheduled_date
                ? new Date(`${String(b.scheduled_date).slice(0, 10)}T00:00:00`)
                    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : null
              return (
                <div
                  key={b.id}
                  className={`sb-cal-tray-chip ${overdue ? 'sb-cal-tray-chip-overdue' : ''}`}
                  style={{ borderLeftColor: kindInfo.color }}
                  title={overdue
                    ? `Overdue — was scheduled for ${whenLabel}`
                    : (b.notes || kindInfo.label)}
                  draggable
                  onDragStart={handleBatchDragStart(b)}
                  onDragEnd={handleBatchDragEnd}
                >
                  <div className="sb-cal-tray-chip-row">
                    {overdue && <span className="sb-cal-tray-chip-badge">Overdue</span>}
                    <span className="sb-cal-tray-chip-label">{_batchLabel(b)}</span>
                    <span className="sb-cal-tray-chip-count">{(b.batch_jobs || []).length}</span>
                  </div>
                  {overdue && whenLabel && (
                    <span className="sb-cal-tray-chip-when">Was scheduled for {whenLabel}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sb-cal-week-grid" style={{ gridTemplateColumns: `repeat(${spanDays}, minmax(0, 1fr))` }}>
        {cells.map(cell => {
          const isDragSrc = dragSrcISO === cell.iso
          const ps = computePromiseDayState(cell, promises, batches)
          const cls = [
            'sb-cal-week-col',
            cell.isToday ? 'sb-cal-week-col-today' : '',
            cell.heavy ? 'sb-cal-week-col-heavy' : '',
            isDragSrc ? 'sb-cal-week-col-dragging' : '',
            ps.state ? `sb-cal-week-col-p-${ps.state}` : '',
          ].filter(Boolean).join(' ')
          const dayName = cell.date.toLocaleDateString('en-US', { weekday: 'short' })
          const monthDay = cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

          // Overdue batches are pulled out of their past cell — they live in
          // the Ready-to-schedule tray now (ITEM 3).
          const cellBatches = cell.batches.filter(b => !overdueIds.has(b.id))
          const allDay = cellBatches.filter(b => b.am_pm == null)
          const amBatches = cellBatches.filter(b => b.am_pm === 'am')
          const pmBatches = cellBatches.filter(b => b.am_pm === 'pm')

          return (
            <div key={cell.iso} className={cls}>
              <div
                className="sb-cal-week-head"
                draggable
                onDragStart={handleDragStart(cell.iso)}
                onDragOver={handleDragOver(cell.iso)}
                onDrop={handleDrop(cell.iso)}
                onDragEnd={() => setDragSrcISO(null)}
                title="Drag onto another day to swap"
              >
                <span className="sb-cal-week-head-grip" aria-hidden="true">⠿</span>
                <span className="sb-cal-week-head-day">{dayName}</span>
                <span className="sb-cal-week-head-date">{monthDay}</span>
                {cellBatches.length >= 5 && (
                  <span className="sb-cal-week-head-heavy">Heavy</span>
                )}
                <WeatherStrip date={cell.date} variant="week" />
              </div>

              {ps.state === 'missed' && ps.missed.length > 0 && (
                <button
                  type="button"
                  className="sb-cal-week-missed"
                  onClick={() => onDayClick?.(cell.iso)}
                  title="Open this day"
                >
                  MISSED — {ps.missed.map(m => m.surname).join(', ')}
                </button>
              )}

              <div className="sb-cal-week-body">
                {renderZone(cell, null, 'All-day', allDay)}
                {renderZone(cell, 'am', 'AM', amBatches)}
                {renderZone(cell, 'pm', 'PM', pmBatches)}
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

// Implicit batch label for tray chips + the schedule toast — explicit title,
// else "Surname +N" from the first stop, else the kind label.
function _batchLabel(b) {
  if (b.title) return b.title
  const stops = b.batch_jobs || []
  if (stops.length === 0) return batchKindInfo(b.kind).label
  const firstJob = stops[0]?.job
  const surname = firstJob?.order?.primary_lastname
    || customerName(firstJob?.order?.customer)
    || batchKindInfo(b.kind).label
  return stops.length === 1 ? surname : `${surname} +${stops.length - 1}`
}

// True when any stop in the batch belongs to a job that has an open promise.
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

  /* ── Tray strip (unscheduled batches, drag source) ──────────────────────── */
  .sb-cal-tray {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 10px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow-x: auto;
  }
  .sb-cal-tray-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .sb-cal-tray-empty {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-style: italic;
  }
  .sb-cal-tray-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-cal-tray-chip {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 10px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    font-size: 12px;
    cursor: grab;
  }
  .sb-cal-tray-chip:active {
    cursor: grabbing;
  }
  .sb-cal-tray-chip-row {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .sb-cal-tray-chip-label {
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-cal-tray-chip-count {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  /* Overdue tray chip — red edge + wash so it reads as a priority re-home. */
  .sb-cal-tray-chip-overdue {
    background: var(--sb-red-bg, #fbe5e5);
    border-color: var(--sb-red, #b54040);
  }
  .sb-cal-tray-chip-badge {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #fff;
    background: var(--sb-red, #b54040);
    padding: 1px 5px;
    border-radius: 999px;
    align-self: center;
  }
  .sb-cal-tray-chip-when {
    font-size: 10px;
    color: var(--sb-red, #b54040);
    font-style: italic;
  }

  /* ── Week grid ──────────────────────────────────────────────────────────── */
  .sb-cal-week-grid {
    display: grid;
    gap: 6px;
  }
  .sb-cal-week-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 320px;
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

  /* Promise-state day coloring. A quiet top accent + a soft wash so the day
     reads its temperature without drowning the cards. Promise state wins over
     the heavy-day amber tint (it's the more important signal). */
  .sb-cal-week-col-p-green {
    background: var(--sb-green-bg, #e6f4ec);
    border-top: 2px solid var(--sb-green, #2d7a4f);
  }
  .sb-cal-week-col-p-amber {
    background: var(--sb-amber-bg, #fbe5b8);
    border-top: 2px solid var(--sb-amber, #b8842a);
  }
  .sb-cal-week-col-p-red {
    background: var(--sb-red-bg, #fbe5e5);
    border-top: 2px solid var(--sb-red, #b54040);
  }
  .sb-cal-week-col-p-missed {
    background: #f2cccc;
    border-top: 2px solid #8a2020;
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

  /* Missed-promise overlay bar — darker red, distinct from the cell wash.
     Clickable: drills into the Day view for that date. */
  .sb-cal-week-missed {
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    background: #8a2020;
    border: 0.5px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    padding: 3px 8px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .sb-cal-week-missed:hover {
    background: #761b1b;
  }
  .sb-cal-week-missed:focus-visible {
    outline: 1.5px solid #fff;
    outline-offset: -2px;
  }

  /* ── AM / PM / all-day drop zones ───────────────────────────────────────── */
  .sb-cal-week-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
  }
  .sb-cal-zone {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px;
    border-radius: var(--sb-r-sm, 6px);
    min-height: 56px;
  }
  /* Subtle separation: AM/PM get a faint top rule + label; all-day reads as a
     thin band above them. Kept quiet so a full day doesn't look striped. */
  .sb-cal-zone-am,
  .sb-cal-zone-pm {
    border-top: 0.5px dashed var(--sb-border);
  }
  /* All zones get a quiet dashed outline while a batch is being dragged, so
     valid drop targets are visible; the zone under the cursor gets a stronger
     solid accent outline + muted fill. */
  .sb-cal-zone--drag-active {
    outline: 1px dashed var(--sb-border);
    outline-offset: -2px;
  }
  .sb-cal-zone--drag-over {
    outline: 1.5px solid var(--sb-accent, #b8842a);
    outline-offset: -2px;
    background: var(--sb-surface-muted);
  }
  .sb-cal-zone-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sb-text-muted);
    opacity: 0.7;
  }
  .sb-cal-zone-empty {
    font-size: 10px;
    color: var(--sb-text-muted);
    font-style: italic;
    opacity: 0.45;
    padding: 2px 4px;
    border: 0.5px dashed transparent;
  }
  /* The empty hint gains a dashed outline on hover so the drop affordance is
     discoverable while dragging. */
  .sb-cal-zone:hover .sb-cal-zone-empty {
    border-color: var(--sb-border);
    opacity: 0.8;
  }

  /* ── Swap confirmation modal ────────────────────────────────────────────── */
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
