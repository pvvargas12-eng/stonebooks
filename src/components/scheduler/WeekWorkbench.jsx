// =============================================================================
// 📚 Stonebooks — Week Workbench
// =============================================================================
// Where batches get built. The page is two stripes:
//   1. Top: in-tray batches (unscheduled / build-only) — easy to drag onto
//      a day when ready, deferred to commit 2.
//   2. Below: a horizontal scrolling row of unscheduled-job columns by
//      batch kind, with checkboxes. Once anything is selected the "Group
//      into batch" action becomes active and opens BatchBuilder.
//
// Selection state lives at the workbench level so checkboxes across
// different columns can feed a single batch (e.g. select two stones-to-
// set rows AND a piggyback rub at the same cemetery → one trip).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BATCH_KINDS,
  batchKindInfo,
  getSchedulableJobs,
  indexPromisesByJob,
} from '../../lib/stonebooksData'
import UnscheduledColumn from './UnscheduledColumn'
import BatchBuilder from './BatchBuilder'

export default function WeekWorkbench({
  jobs,
  batches,
  cemeteries,
  promises,
  trayBatches,
  autoOpenQuickBatch,
  onQuickBatchConsumed,
  onReload,
}) {
  // Selection bundle: jobId → { job, milestone, completion_milestone_key }.
  // Phase 3: the milestone + completion provenance from getSchedulableJobs is
  // carried with each tick so BatchBuilder can persist both keys onto the
  // link row at createBatch time (Phase 2 then cascades the right milestone
  // on dispatch completion).
  const [selectedByJobId, setSelectedByJobId] = useState(() => new Map())
  // Modal state — when null the modal is closed. When an object, contains
  // the initial seed { jobs, defaultKind }.
  const [builderInit, setBuilderInit] = useState(null)

  const schedulableByKind = useMemo(
    () => getSchedulableJobs(jobs, batches),
    [jobs, batches],
  )
  const promisesByJob = useMemo(
    () => indexPromisesByJob(promises || []),
    [promises],
  )

  // Toggle preserves the routing context. The column passes its row entry
  // ({ job, milestone, completion_milestone_key }) on tick; we store it as
  // a stop bundle so the milestone keys travel down to createBatch.
  const handleToggle = useCallback((row, checked) => {
    setSelectedByJobId(prev => {
      const next = new Map(prev)
      if (checked) next.set(row.job.id, row)
      else next.delete(row.job.id)
      return next
    })
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedByJobId(new Map())
  }, [])

  // When opening the builder, infer a default kind from the selection: if
  // every selected job came from the same column, use that column's kind.
  // Mixed selections default to the first kind with any selection — the
  // operator can change it inside the modal.
  const openBuilder = () => {
    const selectedRows = Array.from(selectedByJobId.values())
    if (selectedRows.length === 0) return
    let defaultKind = null
    const kindsHit = []
    for (const k of BATCH_KINDS) {
      const rows = schedulableByKind.get(k.code) || []
      const isSelectedHere = rows.some(r => selectedByJobId.has(r.job.id))
      if (isSelectedHere) kindsHit.push(k.code)
    }
    defaultKind = kindsHit[0] || 'inscription'
    setBuilderInit({
      // Carry milestone + completion through. BatchBuilder treats this as
      // its initialJobs array; the stop list at save time is built from it
      // and includes both source_milestone_key + completion_milestone_key.
      jobs: selectedRows,
      defaultKind,
    })
  }

  const handleCreated = useCallback(() => {
    setBuilderInit(null)
    setSelectedByJobId(new Map())
    onReload?.()
  }, [onReload])

  // Phase 5: "+ New batch" — opens BatchBuilder with an empty stop list so
  // the operator can ad-hoc create a batch shell. Defaults to kind='setting'
  // (highest-stakes operational kind in a stonemason shop) rather than an
  // ad-hoc kind — Production review: defaulting to site_visit taught the
  // wrong path and made stops-less ad-hoc the "easy save," dragging
  // operational discipline. With kind='setting' the save button stays
  // disabled until the operator either ticks cards from the workbench
  // (closing this modal) or explicitly switches the kind dropdown to
  // site_visit/errand for a real ad-hoc event.
  const openQuickBatch = useCallback(() => {
    setBuilderInit({ jobs: [], defaultKind: 'setting' })
  }, [])

  // Phase 5: auto-open the builder when the Month CTA seeded a quick-batch
  // request. Consume the seed so navigating away + back doesn't re-open.
  useEffect(() => {
    if (autoOpenQuickBatch) {
      openQuickBatch()
      onQuickBatchConsumed?.()
    }
  }, [autoOpenQuickBatch, openQuickBatch, onQuickBatchConsumed])

  const selectedCount = selectedByJobId.size

  return (
    <div className="sb-workbench">
      <TrayStrip
        batches={trayBatches}
        onReload={onReload}
      />

      <div className="sb-workbench-action-bar">
        <div className="sb-workbench-action-count">
          {selectedCount === 0
            ? 'Tick cards across columns to build a batch, or start a blank one.'
            : `${selectedCount} selected`}
        </div>
        <div className="sb-workbench-action-buttons">
          {selectedCount > 0 && (
            <button
              type="button"
              className="sb-workbench-action-clear"
              onClick={handleClearSelection}
            >
              Clear selection
            </button>
          )}
          {/* Phase 5: always-available entry. Opens BatchBuilder with no
              preselected stops so the operator isn't gated by ticking first.
              Label is "New batch" not "Quick batch" — "Quick" is dev jargon
              that left owners wondering what the slow path was. */}
          <button
            type="button"
            className="sb-workbench-action-secondary"
            onClick={openQuickBatch}
          >
            + New batch
          </button>
          <button
            type="button"
            className="sb-workbench-action-primary"
            onClick={openBuilder}
            disabled={selectedCount === 0}
          >
            Group into batch
          </button>
        </div>
      </div>

      <div className="sb-workbench-columns">
        {BATCH_KINDS.map(k => (
          <UnscheduledColumn
            key={k.code}
            kindInfo={k}
            rows={schedulableByKind.get(k.code) || []}
            selectedIds={selectedByJobId}
            onToggle={handleToggle}
            promisesByJob={promisesByJob}
          />
        ))}
      </div>

      <BatchBuilder
        open={!!builderInit}
        defaultKind={builderInit?.defaultKind}
        initialJobs={builderInit?.jobs || []}
        cemeteries={cemeteries}
        allJobs={jobs}
        onClose={() => setBuilderInit(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}

// Top tray — batches with scheduled_date IS NULL. Shown as a thin row of
// chips. Empty state is just a one-line hint so the workbench reads as
// quiet on a clean morning.
//
// Phase 5: chips older than 14 days get an amber outline so build-only
// batches don't sit in the tray indefinitely without surfacing. 14d
// chosen per Production Coordinator review: 7d false-positives every
// legitimate cure-window wait (3-7d) and approval cycle (3-14d); 14d
// is past those bands but conservatively short of supplier ETAs (~21d).
// Tooltip reads the actual age so the operator can decide whether to
// schedule or discard. Future polish: tag-based per-kind thresholds.
const TRAY_AGING_DAYS = 14

function TrayStrip({ batches, onReload }) { // eslint-disable-line no-unused-vars
  // `nowMs` lives in state so React 19's purity rules don't flag a bare
  // Date.now() call during render. Lazy initializer fires once on mount; an
  // interval tick keeps chip ages fresh on a long-open tab without forcing
  // a parent re-render to refresh.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const tray = (batches || []).filter(b => !b.scheduled_date && b.status !== 'cancelled')
  if (tray.length === 0) {
    return (
      <div className="sb-workbench-tray sb-workbench-tray-empty">
        Tray empty — built batches without a date will land here.
      </div>
    )
  }
  return (
    <div className="sb-workbench-tray">
      <span className="sb-workbench-tray-label">In tray</span>
      <div className="sb-workbench-tray-chips">
        {tray.map(b => {
          const kindInfo = batchKindInfo(b.kind)
          const ageDays = b.created_at
            ? Math.floor((nowMs - new Date(b.created_at).getTime()) / 86400000)
            : 0
          const isStale = ageDays >= TRAY_AGING_DAYS
          const className = `sb-workbench-tray-chip${isStale ? ' sb-workbench-tray-chip-stale' : ''}`
          const tooltip = isStale
            ? `${b.notes || kindInfo.label} — sitting ${ageDays} days, schedule or discard`
            : (b.notes || kindInfo.label)
          return (
            <div
              key={b.id}
              className={className}
              style={{ borderLeftColor: kindInfo.color }}
              title={tooltip}
            >
              <span className="sb-workbench-tray-chip-label">
                {b.title || kindInfo.label}
              </span>
              <span className="sb-workbench-tray-chip-count">
                {(b.batch_jobs || []).length}
              </span>
              {isStale && (
                <span className="sb-workbench-tray-chip-age" aria-hidden="true">{ageDays}d</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const localStyles = `
  .sb-workbench {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sb-workbench-tray {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow-x: auto;
  }
  .sb-workbench-tray-empty {
    color: var(--sb-text-muted);
    font-size: 12px;
    font-style: italic;
  }
  .sb-workbench-tray-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .sb-workbench-tray-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-workbench-tray-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-left: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    font-size: 12px;
  }
  /* Stale chip — built-only batch sitting in tray ≥ 7 days. Amber border
     + small age badge so the operator can scan for what's slipping. */
  .sb-workbench-tray-chip-stale {
    border-color: var(--sb-amber, #b8842a);
    background: var(--sb-amber-bg, #fbe5b8);
  }
  .sb-workbench-tray-chip-age {
    font-size: 10px;
    font-weight: 600;
    color: var(--sb-amber, #b8842a);
    background: rgba(255, 255, 255, 0.6);
    padding: 1px 5px;
    border-radius: 999px;
    margin-left: 2px;
    font-variant-numeric: tabular-nums;
  }
  .sb-workbench-tray-chip-label {
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-workbench-tray-chip-count {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .sb-workbench-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 14px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-workbench-action-count {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-workbench-action-buttons {
    display: flex;
    gap: 8px;
  }
  .sb-workbench-action-clear,
  .sb-workbench-action-secondary,
  .sb-workbench-action-primary {
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-workbench-action-clear {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-workbench-action-clear:hover {
    color: var(--sb-text);
    background: var(--sb-surface);
  }
  /* "+ New batch" — always-available secondary action. Outlined accent
     so it reads as a peer to "Group into batch" without competing.
     Hover uses sb-surface-muted (not amber) so it doesn't visually
     collide with stale-tray chips when both are on screen. */
  .sb-workbench-action-secondary {
    background: var(--sb-surface);
    color: var(--sb-accent, #b8842a);
    border-color: var(--sb-accent, #b8842a);
  }
  .sb-workbench-action-secondary:hover {
    background: var(--sb-surface-muted);
  }
  .sb-workbench-action-primary {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-workbench-action-primary:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  /* Disabled state — muted text + lighter background instead of just
     opacity, so the bronze fill doesn't read as the active state when
     "+ New batch" (outlined accent) sits next to it. */
  .sb-workbench-action-primary:disabled {
    background: var(--sb-surface-muted);
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
    cursor: not-allowed;
  }

  /* Auto-fit column grid — fits as many 240px columns per row as the
     viewport allows. On phones we collapse to one column at a time so
     each column reads cleanly. */
  .sb-workbench-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-workbench-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-workbench-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
