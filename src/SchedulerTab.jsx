// =============================================================================
// 📚 Stonebooks — Scheduler (merged command center)
// =============================================================================
// ONE surface for building AND executing field/shop work. The old separate
// "Calendar" tab is folded in here. Four zooms:
//   • Day     — the dispatch sheet (mark-complete / running-late / reorder),
//               weather, carryover, cascade warning. (was Calendar → Day)
//   • Week    — the dispatcher's single screen: a hub-fed "Ready to schedule"
//               rail on the LEFT (WeekWorkbench) + the week canvas on the RIGHT
//               (CalendarWeek: Mon–Sat, weather, AM/PM/all-day drop zones, the
//               one unscheduled tray). Drag a ready card onto a day to schedule.
//   • 2-Week  — strategic planning strip. (preserved — not orphaned)
//   • Month   — operator-overview heat grid.
//
// ONE data load (jobs + batches + cemeteries + promises + carryover) feeds every
// zoom — no double-fetch, no two trays. Single-job scheduling lives here
// (scheduleSingleJob → createBatch) so the rail button and the rail→day drag
// share one path + one toast. Reuses MonthLandscape, TwoWeekView, WeekWorkbench,
// CalendarWeek, CalendarDay, WeatherStrip, BatchBuilder, the trip optimizer,
// the promise engine, drag-to-day + undo, and the install-readiness gate —
// this is a layout recombination, not new scheduling logic.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getJobs,
  getBatch,
  getBatches,
  getAllOpenPromises,
  getCarryoverForToday,
  indexPromisesByJob,
  updateBatch,
  createBatch,
  unscheduleBatch,
  batchKindInfo,
  customerName,
  todayLocalISO,
  fmtDate,
} from './lib/stonebooksData'
import { supabase } from './lib/supabase'
import MonthLandscape from './components/scheduler/MonthLandscape'
import TwoWeekView from './components/scheduler/TwoWeekView'
import WeekWorkbench from './components/scheduler/WeekWorkbench'
import CalendarWeek from './components/calendar/CalendarWeek'
import CalendarDay from './components/calendar/CalendarDay'
import WeatherStrip from './components/calendar/WeatherStrip'
import AddEventModal from './components/AddEventModal'
import AddPromiseModal from './components/AddPromiseModal'
import UndoToast from './components/calendar/UndoToast'
import PromiseBanner from './components/scheduler/PromiseBanner'
import SearchBar from './components/SearchBar'

const ZOOMS = [
  { code: 'day',     label: 'Day'     },
  { code: 'week',    label: 'Week'    },
  { code: 'twoweek', label: '2-Week'  },
  { code: 'month',   label: 'Month'   },
]

// eslint-disable-next-line no-unused-vars
export default function SchedulerTab({ variant = 'scheduler', user, profile, onOpenJob, onOpenOrder, onSwitchTab }) {
  // ITEM 2 — the restored Calendar tab is this same component in a view-focused
  // variant: Month-default, no build rail in Week (just the canvas), no
  // promise-making affordance. Same data load, same source of truth.
  const isCalendar = variant === 'calendar'
  const [zoom, setZoom] = useState(isCalendar ? 'month' : 'week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [jobs, setJobs] = useState(null)
  const [batches, setBatches] = useState([])
  const [cemeteries, setCemeteries] = useState([])
  const [promises, setPromises] = useState([])
  const [carryover, setCarryover] = useState([])
  const [loadErr, setLoadErr] = useState(null)
  const [addEventOpen, setAddEventOpen] = useState(false)
  const [addPromiseOpen, setAddPromiseOpen] = useState(false)
  const [cascadeWarning, setCascadeWarning] = useState(null)
  const [schedulingJobId, setSchedulingJobId] = useState(null)
  const [quickBatchSeed, setQuickBatchSeed] = useState(false)

  const actorName = profile?.display_name || 'Operator'
  const actorUserId = user?.id || null

  // ── Toast (drag-undo + single-job feedback) ───────────────────────────────
  const TOAST_MS = 8000
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((t) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ ...t, id: ++toastSeq.current })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ── One data load — every zoom reads slices of this ────────────────────────
  const loadReqId = useRef(0)
  const loadAll = useCallback(async () => {
    const reqId = ++loadReqId.current
    setLoadErr(null)
    try {
      const [jobsData, batchesData, cems, ps, co] = await Promise.all([
        getJobs({ includeClosed: false }),
        getBatches({}),
        _listCemeteries(),
        // includeResolved: the Week day-state engine paints settled promises
        // as permanent green/missed marks (historical performance record).
        getAllOpenPromises({ includeResolved: true }),
        getCarryoverForToday(todayLocalISO()),
      ])
      if (reqId !== loadReqId.current) return     // superseded by a newer load
      setJobs(jobsData || [])
      setBatches(batchesData || [])
      setCemeteries(cems || [])
      setPromises(ps || [])
      setCarryover(co || [])
    } catch (e) {
      if (reqId !== loadReqId.current) return
      setLoadErr(e?.message || 'Failed to load scheduler data')
      setJobs([])
    }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // Card-level 🤡 is OPEN promises only; the Week day-state engine gets the
  // full list (incl. resolved) for its permanent marks.
  const promisesByJob = useMemo(
    () => indexPromisesByJob((promises || []).filter(p => p.kept == null && !p.resolved_at)),
    [promises],
  )

  // ── Day view rich-batch fetch (joined stops + mileage for the dispatch sheet) ─
  const [dayBatches, setDayBatches] = useState(null)
  useEffect(() => {
    if (zoom !== 'day') { setDayBatches(null); return }
    let cancelled = false
    ;(async () => {
      const iso = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`
      const r = await _fetchBatchesWithJoinsForDate(iso)
      if (!cancelled) setDayBatches(r)
    })()
    return () => { cancelled = true }
  }, [zoom, anchor, batches])

  // ── Anchors ────────────────────────────────────────────────────────────────
  // Week canvas is Mon–Sat (6 cols) — Monday of the anchor's week.
  const mondayOf = useMemo(() => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d
  }, [anchor])
  // 2-Week strip stays Sunday-aligned (its grid expects it).
  const sundayOf = useMemo(() => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    d.setDate(d.getDate() - d.getDay())
    return d
  }, [anchor])
  const monthYear = useMemo(() => ({ year: anchor.getFullYear(), month: anchor.getMonth() }), [anchor])

  const goPrev = () => {
    if (zoom === 'month')        setAnchor(p => new Date(p.getFullYear(), p.getMonth() - 1, 1))
    else if (zoom === 'twoweek') setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() - 14))
    else if (zoom === 'day')     setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() - 1))
    else                         setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() - 7))
  }
  const goNext = () => {
    if (zoom === 'month')        setAnchor(p => new Date(p.getFullYear(), p.getMonth() + 1, 1))
    else if (zoom === 'twoweek') setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() + 14))
    else if (zoom === 'day')     setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() + 1))
    else                         setAnchor(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() + 7))
  }
  const goToday = () => setAnchor(new Date())

  // Month / 2-Week day click → drill into the Week command screen.
  const handleDayToWeek = useCallback((cell) => { setAnchor(cell.date); setZoom('week') }, [])
  // Batch / missed-day click → drill into the Day dispatch sheet.
  const handleBatchClick = useCallback((batch) => {
    if (batch?.scheduled_date) {
      setAnchor(new Date(`${String(batch.scheduled_date).slice(0, 10)}T00:00:00`))
      setZoom('day')
    }
  }, [])
  const handleDayDrill = useCallback((iso) => {
    if (!iso) return
    setAnchor(new Date(`${String(iso).slice(0, 10)}T00:00:00`))
    setZoom('day')
  }, [])
  const handleQuickBatchFromMonth = useCallback(() => {
    setAnchor(new Date())
    setZoom('week')
    setQuickBatchSeed(true)
  }, [])
  const consumeQuickBatchSeed = useCallback(() => setQuickBatchSeed(false), [])

  // ── Single-job scheduling (rail button + rail→day drag share this) ─────────
  const scheduleSingleJob = useCallback(async ({ jobId, kind, sourceKey, completionKey, cemeteryId, label }, { date, slot }) => {
    if (!jobId) return
    const kindInfo = batchKindInfo(kind)
    if (kindInfo?.requiresDestination && !cemeteryId) {
      showToast({ text: 'Link a cemetery to this order before scheduling a trip.', error: true })
      return
    }
    setSchedulingJobId(jobId)
    try {
      const res = await createBatch({
        kind,
        scheduled_date: date,
        am_pm: slot || null,
        destination_cemetery_id: kindInfo?.requiresDestination ? cemeteryId : null,
        stops: [{ job_id: jobId, source_milestone_key: sourceKey || null, completion_milestone_key: completionKey || null }],
      })
      setSchedulingJobId(null)
      if (!res?.ok) { showToast({ text: res?.error || 'Could not schedule — try again.', error: true }); return }
      showToast({ text: `Scheduled ${label || 'job'} (${kindInfo?.label || kind}) for ${_dayLabel(date)}${slot ? ` ${slot.toUpperCase()}` : ''}.` })
      loadAll()
    } catch (e) {
      setSchedulingJobId(null)
      showToast({ text: e?.message || 'Could not schedule — try again.', error: true })
    }
  }, [showToast, loadAll])

  // Rail "Schedule →" button (row carries job + milestone provenance).
  const handleScheduleJob = useCallback((row, kindCode, { scheduled_date, am_pm }) => {
    const job = row?.job
    if (!job) return
    scheduleSingleJob({
      jobId: job.id,
      kind: kindCode,
      sourceKey: row.milestone?.milestone_key,
      completionKey: row.completion_milestone_key,
      cemeteryId: job.order?.cemetery?.id || job.cemetery?.id || null,
      label: job.order?.primary_lastname || customerName(job.order?.customer) || 'job',
    }, { date: scheduled_date, slot: am_pm })
  }, [scheduleSingleJob])

  // Rail card dragged onto a CalendarWeek day zone (payload serialized at drag).
  const handleScheduleReadyJob = useCallback((payload, { date, slot }) => {
    scheduleSingleJob({
      jobId: payload?.jobId,
      kind: payload?.kind,
      sourceKey: payload?.sourceKey,
      completionKey: payload?.completionKey,
      cemeteryId: payload?.cemeteryId,
      label: payload?.label,
    }, { date, slot })
  }, [scheduleSingleJob])

  // ── Existing-batch drag reschedule + undo (preserved from Calendar) ────────
  const handleScheduleBatch = useCallback(async ({ batchId, toDate, toSlot, fromDate, fromSlot, label }) => {
    try {
      const res = await updateBatch(batchId, { scheduled_date: toDate, am_pm: toSlot })
      if (!res.ok) { showToast({ text: "Couldn't save — try again", error: true }); return }
      showToast({
        text: `Scheduled ${label} for ${_dayLabel(toDate)} ${_slotLabel(toSlot)}.`,
        undo: { batchId, scheduled_date: fromDate, am_pm: fromSlot },
      })
      loadAll()
    } catch {
      showToast({ text: "Couldn't save — try again", error: true })
    }
  }, [showToast, loadAll])

  // ── Unschedule (ITEM 3) — pull a batch off the calendar back to Ready ───────
  const handleUnscheduleBatch = useCallback(async (batch) => {
    if (!batch?.id) return
    const prevDate = batch.scheduled_date ? String(batch.scheduled_date).slice(0, 10) : null
    const prevSlot = batch.am_pm ?? null
    try {
      const res = await unscheduleBatch(batch.id)
      if (!res.ok) { showToast({ text: res.error || "Couldn't unschedule — try again", error: true }); return }
      showToast({
        text: `Moved “${_batchLabel(batch)}” back to Ready to schedule.`,
        undo: prevDate ? { batchId: batch.id, scheduled_date: prevDate, am_pm: prevSlot } : undefined,
      })
      loadAll()
    } catch {
      showToast({ text: "Couldn't unschedule — try again", error: true })
    }
  }, [showToast, loadAll])

  const handleUndo = useCallback(async () => {
    const u = toast?.undo
    if (!u) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
    try {
      const res = await updateBatch(u.batchId, { scheduled_date: u.scheduled_date, am_pm: u.am_pm })
      if (!res.ok) { showToast({ text: "Couldn't save — try again", error: true }); return }
      loadAll()
    } catch {
      showToast({ text: "Couldn't save — try again", error: true })
    }
  }, [toast, showToast, loadAll])

  return (
    <div className="sb-page sb-page-wide sb-scheduler">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Operations</div>
        <h1 className="sb-page-title">{isCalendar ? 'Calendar' : 'Scheduler'}</h1>
      </div>

      <div className="sb-scheduler-search-row">
        <SearchBar placeholder="Search customers, jobs, orders…" />
        {!isCalendar && (
          <button
            type="button"
            className="sb-scheduler-add-promise"
            onClick={() => setAddPromiseOpen(true)}
          >
            <span aria-hidden="true">🤡</span> Add promise
          </button>
        )}
      </div>

      <PromiseBanner promises={promises} onOpenJob={onOpenJob} />

      <div className="sb-scheduler-controls">
        <div className="sb-scheduler-zoom" role="tablist" aria-label="Scheduler zoom">
          {ZOOMS.map(z => (
            <button
              key={z.code}
              type="button"
              role="tab"
              aria-selected={zoom === z.code}
              className={`sb-scheduler-zoom-chip ${zoom === z.code ? 'sb-scheduler-zoom-chip-active' : ''}`}
              onClick={() => setZoom(z.code)}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="sb-scheduler-anchor">
          {zoom === 'day'
            ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            : zoom === 'month'
              ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : `Week of ${fmtDate(zoom === 'twoweek' ? sundayOf : mondayOf)}`}
        </div>
        <div className="sb-scheduler-controls-right">
          <div className="sb-scheduler-nav">
            <button type="button" className="sb-scheduler-nav-btn" onClick={goPrev}>‹</button>
            <button type="button" className="sb-scheduler-nav-btn" onClick={goToday}>Today</button>
            <button type="button" className="sb-scheduler-nav-btn" onClick={goNext}>›</button>
          </div>
          <button
            type="button"
            className="sb-scheduler-add-event"
            onClick={() => setAddEventOpen(true)}
          >
            + Add event
          </button>
        </div>
      </div>

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>{loadErr}</div>
      )}

      {/* Cascade-warning banner — lives here so it survives the Day reload-
          unmount cycle (lifted from the dispatch subtree). */}
      {cascadeWarning && (
        <div className="sb-scheduler-cascade-warning" role="status">
          <span className="sb-scheduler-cascade-warning-label">Needs review</span>
          <span className="sb-scheduler-cascade-warning-msg">{cascadeWarning}</span>
          <button
            type="button"
            className="sb-scheduler-cascade-warning-dismiss"
            onClick={() => setCascadeWarning(null)}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {jobs === null && !loadErr && <div className="sb-empty">Loading…</div>}

      {jobs !== null && !loadErr && zoom === 'month' && (
        <MonthLandscape
          year={monthYear.year}
          month={monthYear.month}
          batches={batches}
          promises={promises}
          onDayClick={handleDayToWeek}
          onQuickBatch={handleQuickBatchFromMonth}
        />
      )}

      {jobs !== null && !loadErr && zoom === 'twoweek' && (
        <TwoWeekView
          startDate={sundayOf}
          batches={batches}
          promises={promises}
          onDayClick={handleDayToWeek}
          onBatchClick={handleBatchClick}
        />
      )}

      {jobs !== null && !loadErr && zoom === 'week' && (
        isCalendar ? (
          // Calendar variant: the week canvas only — no build rail. Still the
          // same CalendarWeek (drag-to-reschedule, unschedule, overdue tray)
          // over the same data.
          <CalendarWeek
            startDate={mondayOf}
            spanDays={6}
            batches={batches}
            promises={promises}
            promisesByJob={promisesByJob}
            onBatchClick={handleBatchClick}
            onScheduleBatch={handleScheduleBatch}
            onScheduleReadyJob={handleScheduleReadyJob}
            onUnscheduleBatch={handleUnscheduleBatch}
            onDayClick={handleDayDrill}
            onReload={loadAll}
          />
        ) : (
          <div className="sb-sw-split">
            <aside className="sb-sw-rail">
              <div className="sb-sw-rail-head">Ready to schedule</div>
              <WeekWorkbench
                jobs={jobs}
                batches={batches}
                cemeteries={cemeteries}
                promises={promises}
                autoOpenQuickBatch={quickBatchSeed}
                onQuickBatchConsumed={consumeQuickBatchSeed}
                onScheduleJob={handleScheduleJob}
                schedulingJobId={schedulingJobId}
                onReload={loadAll}
              />
            </aside>
            <section className="sb-sw-canvas">
              <CalendarWeek
                startDate={mondayOf}
                spanDays={6}
                batches={batches}
                promises={promises}
                promisesByJob={promisesByJob}
                onBatchClick={handleBatchClick}
                onScheduleBatch={handleScheduleBatch}
                onScheduleReadyJob={handleScheduleReadyJob}
                onUnscheduleBatch={handleUnscheduleBatch}
                onDayClick={handleDayDrill}
                onReload={loadAll}
              />
            </section>
          </div>
        )
      )}

      {jobs !== null && !loadErr && zoom === 'day' && (
        <>
          <WeatherStrip date={anchor} variant="day" />
          <CalendarDay
            date={anchor}
            batches={dayBatches || batches}
            carryover={carryover}
            promisesByJob={promisesByJob}
            actorName={actorName}
            actorUserId={actorUserId}
            onCascadeWarning={setCascadeWarning}
            onUnschedule={handleUnscheduleBatch}
            onReload={loadAll}
          />
        </>
      )}

      <AddEventModal
        open={addEventOpen}
        cemeteries={cemeteries}
        defaultDate={(() => {
          const d = anchor
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        })()}
        onClose={() => setAddEventOpen(false)}
        onCreated={() => { setAddEventOpen(false); loadAll() }}
      />

      <AddPromiseModal
        open={addPromiseOpen}
        onClose={() => setAddPromiseOpen(false)}
        onSaved={() => { setAddPromiseOpen(false); loadAll() }}
      />

      {toast && (
        <UndoToast
          key={toast.id}
          text={toast.text}
          error={!!toast.error}
          canUndo={!!toast.undo}
          durationMs={TOAST_MS}
          onUndo={handleUndo}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}

// Cemetery list for the BatchBuilder optimizer + AddEvent picker.
async function _listCemeteries() {
  const { data, error } = await supabase
    .from('cemeteries')
    .select('id, name, address, geocoded_lat, geocoded_lng, geocoded_at')
    .order('name', { ascending: true })
  if (error) { console.warn('[scheduler] _listCemeteries failed:', error.message); return [] }
  return data || []
}

// Day-view rich fetch — getBatches gives the date-scoped list with shallow
// batch_jobs; getBatch joins each stop's job + milestones + order + cemetery
// for the dispatch spec line. Typical N < 10 batches/day.
async function _fetchBatchesWithJoinsForDate(iso) {
  const list = await getBatches({ from: iso, to: iso })
  if (!list || list.length === 0) return []
  const out = []
  for (const b of list) {
    const detail = await getBatch(b.id)
    if (detail) out.push(detail)
  }
  return out
}

function _batchLabel(b) {
  if (b?.title) return b.title
  const stops = b?.batch_jobs || []
  const first = stops[0]?.job
  const surname = first?.order?.primary_lastname
    || customerName(first?.order?.customer)
    || batchKindInfo(b?.kind)?.label
    || 'batch'
  return stops.length > 1 ? `${surname} +${stops.length - 1}` : surname
}

function _dayLabel(iso) {
  if (!iso) return 'the tray'
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function _slotLabel(slot) {
  if (slot === 'am') return '(AM)'
  if (slot === 'pm') return '(PM)'
  return '(all-day)'
}

const localStyles = `
  .sb-scheduler-search-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .sb-scheduler-add-promise {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--sb-red, #b54040);
    border: 0.5px solid transparent;
    color: white;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 9px 16px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    white-space: nowrap;
    margin-left: auto;
  }
  .sb-scheduler-add-promise:hover { filter: brightness(0.95); }

  .sb-scheduler-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .sb-scheduler-zoom {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-scheduler-zoom-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .sb-scheduler-zoom-chip:hover { color: var(--sb-text); }
  .sb-scheduler-zoom-chip-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15, 20, 25, 0.06);
  }
  .sb-scheduler-anchor {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
    font-family: var(--font-d, 'Playfair Display'), Georgia, serif;
  }
  .sb-scheduler-controls-right {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .sb-scheduler-nav { display: inline-flex; gap: 4px; }
  .sb-scheduler-nav-btn {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .sb-scheduler-nav-btn:hover { color: var(--sb-text); background: var(--sb-surface-muted); }
  .sb-scheduler-add-event {
    background: var(--sb-accent, #b8842a);
    border: 0.5px solid transparent;
    color: white;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 14px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-scheduler-add-event:hover { filter: brightness(0.95); }

  /* Cascade-warning banner (lifted from the Day subtree). */
  .sb-scheduler-cascade-warning {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: #6b4a1c;
    background: #fbe5b8;
    border: 0.5px solid #b8842a;
    font-size: 13px;
    padding: 10px 12px;
    margin-bottom: 16px;
    border-radius: var(--sb-r-sm, 6px);
    line-height: 1.4;
  }
  .sb-scheduler-cascade-warning-label {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #b8842a;
    white-space: nowrap;
    padding-top: 1px;
  }
  .sb-scheduler-cascade-warning-msg { flex: 1; }
  .sb-scheduler-cascade-warning-dismiss {
    background: transparent;
    border: 0.5px solid #b8842a;
    color: #b8842a;
    font: inherit;
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-scheduler-cascade-warning-dismiss:hover { background: rgba(184, 132, 42, 0.12); }

  /* ── Merged Week: rail + canvas ─────────────────────────────────────────── */
  .sb-sw-split {
    display: grid;
    grid-template-columns: minmax(300px, 360px) 1fr;
    gap: 18px;
    align-items: start;
  }
  .sb-sw-rail {
    position: sticky;
    top: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding-right: 2px;
  }
  .sb-sw-rail-head {
    font-family: var(--font-d, 'Playfair Display'), Georgia, serif;
    font-size: 16px;
    font-weight: 600;
    color: var(--sb-text);
    letter-spacing: -0.01em;
  }
  /* In the narrow rail the auto-fit workbench column grid collapses to a single
     stacked column — i.e. the ready-work reads as stage groups top to bottom. */
  .sb-sw-rail .sb-workbench-columns {
    grid-template-columns: 1fr;
  }
  .sb-sw-canvas { min-width: 0; }

  @media (max-width: 1024px) {
    .sb-sw-split { grid-template-columns: 1fr; }
    .sb-sw-rail { position: static; max-height: none; }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-scheduler-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-scheduler-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
