// =============================================================================
// 📚 Stonebooks — Scheduler tab
// =============================================================================
// The surface where work batches get built. Three zooms:
//   • Month     — operator-overview heat grid, promised days loud.
//   • 2-Week    — strategic planning across the next 14 days.
//   • Week      — the workbench (column-based unscheduled selector + tray).
//
// Loads jobs + batches + cemeteries + open promises on mount. Each subview
// reads the same data — Month / 2-Week / Week are different visualizations
// of the same operational state.
//
// Click-into-batch from Month or 2-Week routes to the Calendar tab's Day
// view (the dispatch surface), not into a Scheduler drill. The Scheduler
// is for *building*; the Calendar is for *executing*.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getJobs,
  getBatches,
  getAllOpenPromises,
} from './lib/stonebooksData'
import { supabase } from './lib/supabase'
import MonthLandscape from './components/scheduler/MonthLandscape'
import TwoWeekView from './components/scheduler/TwoWeekView'
import WeekWorkbench from './components/scheduler/WeekWorkbench'
import PromiseBanner from './components/scheduler/PromiseBanner'
import SearchBar from './components/SearchBar'
import AddPromiseModal from './components/AddPromiseModal'

const ZOOMS = [
  { code: 'month',    label: 'Month'   },
  { code: 'twoweek',  label: '2-Week'  },
  { code: 'week',     label: 'Week'    },
]

export default function SchedulerTab({ onOpenJob, onSwitchTab }) {
  const [zoom, setZoom] = useState('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [jobs, setJobs] = useState(null)
  const [batches, setBatches] = useState([])
  const [cemeteries, setCemeteries] = useState([])
  const [promises, setPromises] = useState([])
  const [loadErr, setLoadErr] = useState(null)
  const [addPromiseOpen, setAddPromiseOpen] = useState(false)

  // Parallel load — every subview consumes some slice of (jobs, batches,
  // cemeteries, promises). One round-trip on mount keeps the surface fast.
  const loadAll = useCallback(async () => {
    setLoadErr(null)
    try {
      const [jobsData, batchesData, cems, ps] = await Promise.all([
        getJobs({ includeClosed: false }),
        getBatches({}),
        _listCemeteries(),
        getAllOpenPromises({}),
      ])
      setJobs(jobsData || [])
      setBatches(batchesData || [])
      setCemeteries(cems || [])
      setPromises(ps || [])
    } catch (e) {
      setLoadErr(e?.message || 'Failed to load scheduler data')
      setJobs([])
    }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const handleDayClick = useCallback((cell) => {
    // Drill from Month/2-Week into the workbench Week view for the week
    // containing the clicked day. The operator continues building from there.
    setAnchor(cell.date)
    setZoom('week')
  }, [])

  // Phase 5: empty-state CTA on Month → switch to Week + flag that the
  // workbench should auto-open BatchBuilder on the next render. The flag
  // is consumed by WeekWorkbench (via onQuickBatchConsumed) so subsequent
  // re-renders don't keep re-opening the dialog.
  const [quickBatchSeed, setQuickBatchSeed] = useState(false)
  const handleQuickBatchFromMonth = useCallback(() => {
    setAnchor(new Date())     // anchor to today's week — the obvious default
    setZoom('week')
    setQuickBatchSeed(true)
  }, [])
  const consumeQuickBatchSeed = useCallback(() => setQuickBatchSeed(false), [])

  const handleBatchClick = useCallback(() => {
    // Built batches route to the Calendar Day view for dispatch.
    onSwitchTab?.('calendar')
  }, [onSwitchTab])

  // Anchor controls — month view uses the current month/year; 2-Week and
  // Week use a Sunday-aligned start date computed from anchor.
  const sundayOf = useMemo(() => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
    d.setDate(d.getDate() - d.getDay())
    return d
  }, [anchor])

  const monthYear = useMemo(() => ({
    year:  anchor.getFullYear(),
    month: anchor.getMonth(),
  }), [anchor])

  const goPrev = () => {
    if (zoom === 'month') {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    } else if (zoom === 'twoweek') {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 14))
    } else {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7))
    }
  }
  const goNext = () => {
    if (zoom === 'month') {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    } else if (zoom === 'twoweek') {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 14))
    } else {
      setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7))
    }
  }
  const goToday = () => setAnchor(new Date())

  return (
    <div className="sb-page sb-page-wide sb-scheduler">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Operations</div>
        <h1 className="sb-page-title">Scheduler</h1>
      </div>

      <div className="sb-scheduler-search-row">
        <SearchBar placeholder="Search customers, jobs, orders…" />
        <button
          type="button"
          className="sb-scheduler-add-promise"
          onClick={() => setAddPromiseOpen(true)}
        >
          <span aria-hidden="true">🤡</span> Add promise
        </button>
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
        <div className="sb-scheduler-nav">
          <button type="button" className="sb-scheduler-nav-btn" onClick={goPrev}>‹</button>
          <button type="button" className="sb-scheduler-nav-btn" onClick={goToday}>Today</button>
          <button type="button" className="sb-scheduler-nav-btn" onClick={goNext}>›</button>
        </div>
      </div>

      {loadErr && (
        <div className="sb-empty" style={{ color: 'var(--sb-red, #b54040)' }}>
          {loadErr}
        </div>
      )}
      {jobs === null && !loadErr && (
        <div className="sb-empty">Loading…</div>
      )}

      {jobs !== null && !loadErr && zoom === 'month' && (
        <MonthLandscape
          year={monthYear.year}
          month={monthYear.month}
          batches={batches}
          promises={promises}
          onDayClick={handleDayClick}
          onQuickBatch={handleQuickBatchFromMonth}
        />
      )}
      {jobs !== null && !loadErr && zoom === 'twoweek' && (
        <TwoWeekView
          startDate={sundayOf}
          batches={batches}
          promises={promises}
          onDayClick={handleDayClick}
          onBatchClick={handleBatchClick}
        />
      )}
      {jobs !== null && !loadErr && zoom === 'week' && (
        <WeekWorkbench
          jobs={jobs}
          batches={batches}
          cemeteries={cemeteries}
          promises={promises}
          trayBatches={batches.filter(b => !b.scheduled_date)}
          autoOpenQuickBatch={quickBatchSeed}
          onQuickBatchConsumed={consumeQuickBatchSeed}
          onReload={loadAll}
        />
      )}

      <AddPromiseModal
        open={addPromiseOpen}
        onClose={() => setAddPromiseOpen(false)}
        onSaved={() => { setAddPromiseOpen(false); loadAll() }}
      />
    </div>
  )
}

// Cemetery list helper — lightweight selection used by the BatchBuilder.
// Filtered to non-archived cemeteries; ordered by name so the dropdown is
// scannable.
async function _listCemeteries() {
  const { data, error } = await supabase
    .from('cemeteries')
    .select('id, name, address, geocoded_lat, geocoded_lng, geocoded_at')
    .order('name', { ascending: true })
  if (error) {
    console.warn('[scheduler] _listCemeteries failed:', error.message)
    return []
  }
  return data || []
}

const localStyles = `
  /* Search row — sits below the page head, hosts global search + the
     loud "Add promise" button. The button is the discoverable entry
     point for the most-important operational verb on this page. */
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
  .sb-scheduler-add-promise:hover {
    filter: brightness(0.95);
  }
  .sb-scheduler-add-promise:focus-visible {
    outline: 0.5px solid var(--sb-accent);
    outline-offset: 2px;
  }

  .sb-scheduler-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
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
  .sb-scheduler-zoom-chip:hover {
    color: var(--sb-text);
  }
  .sb-scheduler-zoom-chip-active {
    background: var(--sb-surface);
    color: var(--sb-text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(15, 20, 25, 0.06);
  }
  .sb-scheduler-nav {
    display: inline-flex;
    gap: 4px;
  }
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
  .sb-scheduler-nav-btn:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-scheduler-tab-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-scheduler-tab-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
