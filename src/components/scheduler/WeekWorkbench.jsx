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
  customerName,
  getSchedulableJobs,
  indexPromisesByJob,
} from '../../lib/stonebooksData'
import UnscheduledColumn from './UnscheduledColumn'
import BatchBuilder from './BatchBuilder'

// The "Ready to schedule" rail of the merged Scheduler Week. Hub-fed stage
// columns + the red Blocked group + the multi-stop batch builder. Single-job
// scheduling is LIFTED to the parent (SchedulerTab) so the rail button and the
// drag-onto-a-day path share one createBatch + one toast — passed in as
// onScheduleJob / schedulingJobId. The unscheduled batch tray now lives on the
// CalendarWeek canvas (one tray, not two), so this no longer renders its own.
export default function WeekWorkbench({
  jobs,
  batches,
  cemeteries,
  promises,
  autoOpenQuickBatch,
  onQuickBatchConsumed,
  onScheduleJob,
  schedulingJobId,
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

  const { buckets: schedulableByKind, blocked: blockedInstalls } = useMemo(
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

      <BlockedInstalls rows={blockedInstalls} />

      <div className="sb-workbench-columns">
        {BATCH_KINDS.map(k => (
          <UnscheduledColumn
            key={k.code}
            kindInfo={k}
            rows={schedulableByKind.get(k.code) || []}
            selectedIds={selectedByJobId}
            onToggle={handleToggle}
            onScheduleJob={onScheduleJob}
            schedulingJobId={schedulingJobId}
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

// Blocked installs — jobs that have reached ready_to_install but are NOT
// safe to put a crew on the road for (permit not approved / foundation not
// poured / stone not received). Surfaced loudly above the columns so the
// scheduler can tell "no installs ready" from "installs ready but blocked —
// go clear the permit." Read-only: the fix lives in the Permit Hub / job
// milestones, not here. Hidden entirely when nothing is blocked.
function BlockedInstalls({ rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="sb-wb-blocked">
      <div className="sb-wb-blocked-head">
        <span className="sb-wb-blocked-title">Blocked — not ready to schedule</span>
        <span className="sb-wb-blocked-count">{rows.length}</span>
      </div>
      <div className="sb-wb-blocked-rows">
        {rows.map(({ job, reasons }) => {
          const surname = job.order?.primary_lastname
            || customerName(job.order?.customer)
            || 'Unnamed'
          const cemetery = job.order?.cemetery?.name || job.cemetery?.name || null
          return (
            <div key={job.id} className="sb-wb-blocked-row">
              <div className="sb-wb-blocked-who">
                <span className="sb-wb-blocked-surname">{surname}</span>
                {cemetery && <span className="sb-wb-blocked-cem">{cemetery}</span>}
              </div>
              <div className="sb-wb-blocked-reasons">
                {(reasons || []).map(r => (
                  <span key={r} className="sb-wb-blocked-reason">{r}</span>
                ))}
              </div>
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

  /* Blocked installs — red-tinted band. Reads as a stop sign above the
     schedulable columns; collapses to nothing when empty. */
  .sb-wb-blocked {
    border: 0.5px solid var(--sb-red, #b3261e);
    border-left: 3px solid var(--sb-red, #b3261e);
    background: var(--sb-red-bg, #fbe9e7);
    border-radius: var(--sb-r-sm, 6px);
    padding: 10px 14px;
  }
  .sb-wb-blocked-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .sb-wb-blocked-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--sb-red, #b3261e);
  }
  .sb-wb-blocked-count {
    font-size: 11px;
    font-weight: 600;
    color: white;
    background: var(--sb-red, #b3261e);
    border-radius: 999px;
    padding: 1px 8px;
    font-variant-numeric: tabular-nums;
  }
  .sb-wb-blocked-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sb-wb-blocked-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 6px 10px;
    background: var(--sb-surface, #fff);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-wb-blocked-who {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sb-wb-blocked-surname {
    font-size: 13px;
    font-weight: 600;
    color: var(--sb-text);
  }
  .sb-wb-blocked-cem {
    font-size: 12px;
    color: var(--sb-text-muted);
  }
  .sb-wb-blocked-reasons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-wb-blocked-reason {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-red, #b3261e);
    background: var(--sb-red-bg, #fbe9e7);
    border: 0.5px solid var(--sb-red, #b3261e);
    border-radius: 999px;
    padding: 2px 9px;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-workbench-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-workbench-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
