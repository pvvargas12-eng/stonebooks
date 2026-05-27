// =============================================================================
// 📚 Stonebooks — Calendar tab (dispatch surface)
// =============================================================================
// Where placed batches live. Two zooms:
//   • Week — placed batches per day, day-header drag-to-swap, heavy-day warning
//   • Day  — dispatch sheet with field/shop split, mileage, stop reorder,
//            running-late status, carryover banner.
//
// The Calendar tab is the *execution* surface. The Scheduler tab is the
// *building* surface. Click a batch card on Week → drill into Day view
// pinned to that batch's date.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getBatches,
  getBatch,
  getAllOpenPromises,
  getCarryoverForToday,
  indexPromisesByJob,
  updateBatch,
  todayLocalISO,
  fmtDate,
} from './lib/stonebooksData'
import CalendarWeek from './components/calendar/CalendarWeek'
import CalendarDay from './components/calendar/CalendarDay'
import WeatherStrip from './components/calendar/WeatherStrip'
import AddEventModal from './components/AddEventModal'
import UndoToast from './components/calendar/UndoToast'
import { supabase } from './lib/supabase'

const ZOOMS = [
  { code: 'week', label: 'Week' },
  { code: 'day',  label: 'Day'  },
]

// eslint-disable-next-line no-unused-vars
export default function CalendarTab({ user, profile, onOpenJob, onOpenOrder }) {
  const [zoom, setZoom] = useState('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [batches, setBatches] = useState([])
  const [promises, setPromises] = useState([])
  const [carryover, setCarryover] = useState([])
  const [cemeteries, setCemeteries] = useState([])
  const [loadErr, setLoadErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addEventOpen, setAddEventOpen] = useState(false)

  // Drag-to-schedule undo toast. Only the most recent toast shows; the 8s
  // auto-dismiss timer is reset on each new toast. `id` forces UndoToast to
  // remount per toast so its countdown progress bar restarts.
  const TOAST_MS = 8000
  const [toast, setToast] = useState(null)        // { id, text, error?, undo?: { batchId, scheduled_date, am_pm } }
  const toastTimer = useRef(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((t) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ ...t, id: ++toastSeq.current })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const actorName = profile?.display_name || 'Operator'

  // Monotonic request token — only the latest loadAll response writes state, so
  // overlapping reloads (rapid drops / undo) can't clobber with stale rows.
  const loadReqId = useRef(0)
  const loadAll = useCallback(async () => {
    const reqId = ++loadReqId.current
    setLoading(true)
    setLoadErr(null)
    try {
      const [b, p, c, cems] = await Promise.all([
        getBatches({}),
        // includeResolved: the Week day-state engine renders settled promises
        // as permanent green/missed marks (the historical performance record).
        getAllOpenPromises({ includeResolved: true }),
        getCarryoverForToday(todayLocalISO()),
        _listCemeteriesForEvent(),
      ])
      if (reqId !== loadReqId.current) return    // superseded by a newer load — drop
      setBatches(b || [])
      setPromises(p || [])
      setCarryover(c || [])
      setCemeteries(cems || [])
    } catch (e) {
      if (reqId !== loadReqId.current) return
      setLoadErr(e?.message || 'Failed to load calendar data')
    }
    if (reqId === loadReqId.current) setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // Card-level 🤡 treatment is for OPEN promises only — a settled (resolved)
  // promise shouldn't ring a batch card. The Week day-state engine, by
  // contrast, receives the full `promises` list (incl. resolved) for its
  // permanent green/missed marks.
  const promisesByJob = useMemo(
    () => indexPromisesByJob((promises || []).filter(p => p.kept == null && !p.resolved_at)),
    [promises],
  )

  // Sunday-aligned start for Week view; the Day view uses anchor directly.
  const sundayOf = useMemo(() => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    d.setDate(d.getDate() - d.getDay())
    return d
  }, [anchor])

  const goPrev = () => {
    if (zoom === 'week') setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7))
    else                 setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1))
  }
  const goNext = () => {
    if (zoom === 'week') setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7))
    else                 setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1))
  }
  const goToday = () => setAnchor(new Date())

  const handleBatchClick = useCallback((batch) => {
    if (batch.scheduled_date) {
      setAnchor(new Date(`${String(batch.scheduled_date).slice(0, 10)}T00:00:00`))
      setZoom('day')
    }
  }, [])

  // Drill into the Day view for a given ISO date (used by a missed-day click).
  const handleDayClick = useCallback((iso) => {
    if (!iso) return
    setAnchor(new Date(`${String(iso).slice(0, 10)}T00:00:00`))
    setZoom('day')
  }, [])

  // Drag-to-schedule: persist the batch's new date + slot via updateBatch,
  // then surface an undo toast holding the previous { date, slot } for 8s.
  const handleScheduleBatch = useCallback(async ({ batchId, toDate, toSlot, fromDate, fromSlot, label }) => {
    try {
      const res = await updateBatch(batchId, { scheduled_date: toDate, am_pm: toSlot })
      if (!res.ok) {
        showToast({ text: "Couldn't save — try again", error: true })
        return   // no optimistic move was applied; nothing to reload
      }
      showToast({
        text: `Scheduled ${label} for ${_dayLabel(toDate)} ${_slotLabel(toSlot)}.`,
        undo: { batchId, scheduled_date: fromDate, am_pm: fromSlot },
      })
      loadAll()
    } catch {
      showToast({ text: "Couldn't save — try again", error: true })
    }
  }, [showToast, loadAll])

  const handleUndo = useCallback(async () => {
    const u = toast?.undo
    if (!u) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
    try {
      const res = await updateBatch(u.batchId, { scheduled_date: u.scheduled_date, am_pm: u.am_pm })
      if (!res.ok) {
        showToast({ text: "Couldn't save — try again", error: true })
        return
      }
      loadAll()
    } catch {
      showToast({ text: "Couldn't save — try again", error: true })
    }
  }, [toast, showToast, loadAll])

  // Pre-fetched stops + mileage are only on Day view because getBatch returns
  // a richer joined shape than getBatches. The Week view's per-batch joins
  // are sufficient for the card render; Day view needs full job + milestones
  // + order joins to render the dispatch spec line. Build that lazily.
  const [dayBatches, setDayBatches] = useState(null)
  useEffect(() => {
    if (zoom !== 'day') {
      setDayBatches(null)
      return
    }
    // Re-fetch with the day join shape. Cheap — typically <10 batches per day.
    let cancelled = false
    ;(async () => {
      const iso = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`
      const r = await _fetchBatchesWithJoinsForDate(iso)
      if (!cancelled) setDayBatches(r)
    })()
    return () => { cancelled = true }
  }, [zoom, anchor, batches])

  return (
    <div className="sb-page sb-page-wide sb-calendar">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Operations</div>
        <h1 className="sb-page-title">Calendar</h1>
      </div>

      <div className="sb-calendar-controls">
        <div className="sb-calendar-zoom" role="tablist" aria-label="Calendar zoom">
          {ZOOMS.map(z => (
            <button
              key={z.code}
              type="button"
              role="tab"
              aria-selected={zoom === z.code}
              className={`sb-calendar-zoom-chip ${zoom === z.code ? 'sb-calendar-zoom-chip-active' : ''}`}
              onClick={() => setZoom(z.code)}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="sb-calendar-anchor">
          {zoom === 'day'
            ? anchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            : `Week of ${fmtDate(sundayOf)}`}
        </div>
        <div className="sb-calendar-nav">
          <button type="button" className="sb-calendar-nav-btn" onClick={goPrev}>‹</button>
          <button type="button" className="sb-calendar-nav-btn" onClick={goToday}>Today</button>
          <button type="button" className="sb-calendar-nav-btn" onClick={goNext}>›</button>
        </div>
        <button
          type="button"
          className="sb-calendar-add-event"
          onClick={() => setAddEventOpen(true)}
        >
          + Add event
        </button>
      </div>

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>
          {loadErr}
        </div>
      )}
      {loading && !loadErr && (
        <div className="sb-empty">Loading…</div>
      )}

      {!loading && !loadErr && zoom === 'week' && (
        <CalendarWeek
          startDate={sundayOf}
          spanDays={7}
          batches={batches}
          promises={promises}
          promisesByJob={promisesByJob}
          onBatchClick={handleBatchClick}
          onScheduleBatch={handleScheduleBatch}
          onDayClick={handleDayClick}
          onReload={loadAll}
        />
      )}

      {!loading && !loadErr && zoom === 'day' && (
        <>
          <WeatherStrip date={anchor} variant="day" />
          <CalendarDay
            date={anchor}
            batches={dayBatches || batches}
            carryover={carryover}
            promisesByJob={promisesByJob}
            actorName={actorName}
            onReload={loadAll}
          />
        </>
      )}

      <AddEventModal
        open={addEventOpen}
        cemeteries={cemeteries}
        defaultDate={
          (() => {
            const d = anchor
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          })()
        }
        onClose={() => setAddEventOpen(false)}
        onCreated={() => { setAddEventOpen(false); loadAll() }}
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

// Toast date label, e.g. "Thu Jun 5". Parses the ISO at local midnight to
// avoid a UTC day shift.
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

async function _listCemeteriesForEvent() {
  const { data, error } = await supabase
    .from('cemeteries')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) { console.warn('[calendar] cemeteries fetch failed:', error.message); return [] }
  return data || []
}

// Lazy day-batch fetch with rich joins — getBatches gives the date-scoped
// list with shallow batch_jobs; getBatch returns the per-stop joined job
// + milestones + order + customer + cemetery shape the dispatch sheet
// needs. Two passes keep the SQL simple; typical N is <10 batches per day
// so the round-trip count is small.
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

const localStyles = `
  .sb-calendar-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .sb-calendar-zoom {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    background: var(--sb-surface-muted);
    border-radius: 999px;
  }
  .sb-calendar-zoom-chip {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 999px;
    cursor: pointer;
  }
  .sb-calendar-zoom-chip:hover {
    color: var(--sb-text);
  }
  .sb-calendar-zoom-chip-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15, 20, 25, 0.06);
  }
  .sb-calendar-anchor {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
  }
  .sb-calendar-nav {
    display: inline-flex;
    gap: 4px;
  }
  .sb-calendar-nav-btn {
    background: transparent;
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
  }
  .sb-calendar-nav-btn:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }

  /* + Add event — the accent-tinted entry point for ad-hoc calendar
     entries. Sits at the right edge of the controls row so it never
     competes with the zoom toggle for primary attention. */
  .sb-calendar-add-event {
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
  .sb-calendar-add-event:hover {
    filter: brightness(0.95);
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-calendar-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-calendar-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
