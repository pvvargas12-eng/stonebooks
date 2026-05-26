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

import { useCallback, useMemo, useState } from 'react'
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
  onReload,
}) {
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

  const handleToggle = useCallback((job, checked) => {
    setSelectedByJobId(prev => {
      const next = new Map(prev)
      if (checked) next.set(job.id, job)
      else next.delete(job.id)
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
    const selectedJobs = Array.from(selectedByJobId.values())
    if (selectedJobs.length === 0) return
    let defaultKind = null
    const kindsHit = []
    for (const k of BATCH_KINDS) {
      const rows = schedulableByKind.get(k.code) || []
      const isSelectedHere = rows.some(r => selectedByJobId.has(r.job.id))
      if (isSelectedHere) kindsHit.push(k.code)
    }
    defaultKind = kindsHit[0] || 'inscription'
    setBuilderInit({
      jobs: selectedJobs.map(j => ({ job: j })),
      defaultKind,
    })
  }

  const handleCreated = useCallback(() => {
    setBuilderInit(null)
    setSelectedByJobId(new Map())
    onReload?.()
  }, [onReload])

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
            ? 'Tick cards across columns to build a batch.'
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
function TrayStrip({ batches, onReload }) {
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
          return (
            <div
              key={b.id}
              className="sb-workbench-tray-chip"
              style={{ borderLeftColor: kindInfo.color }}
              title={b.notes || kindInfo.label}
            >
              <span className="sb-workbench-tray-chip-label">
                {b.title || kindInfo.label}
              </span>
              <span className="sb-workbench-tray-chip-count">
                {(b.batch_jobs || []).length}
              </span>
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
  .sb-workbench-action-primary {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-workbench-action-primary:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-workbench-action-primary:disabled {
    opacity: 0.6;
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
