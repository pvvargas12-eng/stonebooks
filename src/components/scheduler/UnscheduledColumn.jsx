// =============================================================================
// 📚 Stonebooks — Unscheduled column
// =============================================================================
// One column of actionable jobs that qualify for a specific batch kind.
// Lives inside WeekWorkbench. Each card shows the customer surname, the
// cemetery name, the milestone label that gates this batch kind, and a
// checkbox for inclusion in the next batch-builder action.
//
// The column displays its kind's color stripe at the top so the operator
// can scan visually across columns by color. Counts include any active
// promise badges on jobs that have one.
// =============================================================================

import { useState } from 'react'
import { customerName, todayLocalISO } from '../../lib/stonebooksData'
import PromiseBadge from './PromiseBadge'

export default function UnscheduledColumn({
  kindInfo,
  rows,
  selectedIds,
  onToggle,
  onScheduleJob,
  schedulingJobId,
  promisesByJob,
}) {
  // Which card's inline "schedule a single job" picker is open + its draft
  // date/slot. Only one open at a time per column.
  const [pickerJobId, setPickerJobId] = useState(null)
  const [pickDate, setPickDate] = useState('')
  const [pickSlot, setPickSlot] = useState('allday')

  const openPicker = (jobId) => {
    setPickerJobId(jobId)
    setPickDate(todayLocalISO())
    setPickSlot('allday')
  }
  const closePicker = () => setPickerJobId(null)
  const confirmPicker = (row) => {
    if (!pickDate) return
    onScheduleJob?.(row, kindInfo.code, {
      scheduled_date: pickDate,
      am_pm: pickSlot === 'allday' ? null : pickSlot,
    })
    setPickerJobId(null)
  }

  const total = rows.length
  return (
    <section className="sb-uncol" style={{ borderTopColor: kindInfo.color }}>
      <header className="sb-uncol-head">
        <span className="sb-uncol-label">{kindInfo.label}</span>
        <span className="sb-uncol-count">{total}</span>
      </header>
      {total === 0 ? (
        <div className="sb-uncol-empty">Nothing waiting.</div>
      ) : (
        <ul className="sb-uncol-list">
          {rows.map((row) => {
            const { job, milestone } = row
            const surname = job.order?.primary_lastname
              || customerName(job.order?.customer)
              || '—'
            const cemetery = job.order?.cemetery?.name || job.cemetery?.name || null
            const promises = promisesByJob?.get(job.id) || []
            const checked = selectedIds.has(job.id)
            const pickerOpen = pickerJobId === job.id
            const busy = schedulingJobId === job.id
            // Drag payload — drop onto a CalendarWeek day zone schedules a
            // 1-stop batch (the rail→canvas drag the merged Week is built on).
            const handleDragStart = (e) => {
              const payload = {
                type: 'ready-job',
                jobId: job.id,
                kind: kindInfo.code,
                sourceKey: milestone?.milestone_key || null,
                completionKey: row.completion_milestone_key || null,
                cemeteryId: job.order?.cemetery?.id || job.cemetery?.id || null,
                label: surname,
              }
              try {
                e.dataTransfer.setData('application/x-sb-readyjob', JSON.stringify(payload))
                e.dataTransfer.effectAllowed = 'copy'
              } catch { /* older browsers — drop falls back gracefully */ }
            }
            return (
              <li
                key={job.id}
                className="sb-uncol-card"
                draggable={!pickerOpen}
                onDragStart={pickerOpen ? undefined : handleDragStart}
                title="Drag onto a day to schedule"
              >
                <label className="sb-uncol-card-label">
                  <input
                    type="checkbox"
                    className="sb-uncol-card-checkbox"
                    checked={checked}
                    // Pass the WHOLE row entry (job + milestone +
                    // completion_milestone_key) so WeekWorkbench can persist
                    // provenance through to createBatch (Phase 3).
                    onChange={e => onToggle?.(row, e.target.checked)}
                  />
                  <div className="sb-uncol-card-body">
                    <div className="sb-uncol-card-primary">
                      <span className="sb-uncol-card-grip" aria-hidden="true">⠿</span>
                      <span className="sb-uncol-card-surname">{surname}</span>
                      {promises.length > 0 && (
                        <PromiseBadge promise={promises[0]} size="sm" />
                      )}
                    </div>
                    {cemetery && (
                      <div className="sb-uncol-card-secondary">{cemetery}</div>
                    )}
                    {milestone?.label && (
                      <div className="sb-uncol-card-stage">{milestone.label}</div>
                    )}
                  </div>
                </label>

                {/* Single-job schedule — sits OUTSIDE the checkbox label so it
                    doesn't toggle selection. Multi-stop building still uses the
                    checkbox + "Group into batch". */}
                {!pickerOpen ? (
                  <button
                    type="button"
                    className="sb-uncol-card-sched"
                    onClick={() => openPicker(job.id)}
                    disabled={busy}
                  >
                    {busy ? 'Scheduling…' : 'Schedule →'}
                  </button>
                ) : (
                  <div className="sb-uncol-sched-picker">
                    <input
                      type="date"
                      className="sb-uncol-sched-date"
                      value={pickDate}
                      onChange={e => setPickDate(e.target.value)}
                      aria-label="Schedule date"
                    />
                    <select
                      className="sb-uncol-sched-slot"
                      value={pickSlot}
                      onChange={e => setPickSlot(e.target.value)}
                      aria-label="Time slot"
                    >
                      <option value="allday">All day</option>
                      <option value="am">AM</option>
                      <option value="pm">PM</option>
                    </select>
                    <div className="sb-uncol-sched-actions">
                      <button type="button" className="sb-uncol-sched-cancel" onClick={closePicker}>Cancel</button>
                      <button type="button" className="sb-uncol-sched-go" onClick={() => confirmPicker(row)} disabled={!pickDate || busy}>Schedule</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const localStyles = `
  .sb-uncol {
    display: flex;
    flex-direction: column;
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    border-top: 3px solid transparent;
    border-radius: var(--sb-r-sm, 6px);
    min-height: 220px;
  }
  .sb-uncol-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-uncol-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sb-uncol-count {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-uncol-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 16px 14px;
    font-style: italic;
  }
  .sb-uncol-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .sb-uncol-card {
    border-bottom: 0.5px solid var(--sb-border);
    cursor: grab;
  }
  .sb-uncol-card:active {
    cursor: grabbing;
  }
  .sb-uncol-card:last-child {
    border-bottom: none;
  }
  .sb-uncol-card-grip {
    font-size: 11px;
    color: var(--sb-text-muted);
    line-height: 1;
    opacity: 0.4;
    transition: opacity 0.12s;
  }
  .sb-uncol-card:hover .sb-uncol-card-grip {
    opacity: 0.85;
  }
  .sb-uncol-card-label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .sb-uncol-card-label:hover {
    background: var(--sb-surface-muted);
  }
  .sb-uncol-card-checkbox {
    margin-top: 3px;
    accent-color: var(--sb-accent, #b8842a);
    cursor: pointer;
  }
  .sb-uncol-card-body {
    flex: 1;
    min-width: 0;
  }
  .sb-uncol-card-primary {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .sb-uncol-card-surname {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-uncol-card-secondary {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
  }
  .sb-uncol-card-stage {
    font-size: 11px;
    color: var(--sb-text-secondary);
    margin-top: 2px;
    font-style: italic;
  }

  /* Single-job schedule affordance — quiet bronze link until used; the inline
     picker expands below the card body. */
  .sb-uncol-card-sched {
    display: block;
    margin: 0 14px 10px 36px;
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-accent, #b8842a);
    cursor: pointer;
  }
  .sb-uncol-card-sched:hover:not(:disabled) { text-decoration: underline; }
  .sb-uncol-card-sched:disabled { color: var(--sb-text-muted); cursor: default; }
  .sb-uncol-sched-picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0 14px 10px 36px;
    padding: 8px 10px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-uncol-sched-date,
  .sb-uncol-sched-slot {
    font: inherit;
    font-size: 12px;
    padding: 5px 8px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-uncol-sched-actions {
    display: inline-flex;
    gap: 6px;
    margin-left: auto;
  }
  .sb-uncol-sched-cancel,
  .sb-uncol-sched-go {
    font: inherit;
    font-size: 12px;
    padding: 5px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    border: 0.5px solid transparent;
  }
  .sb-uncol-sched-cancel {
    background: transparent;
    border-color: var(--sb-border);
    color: var(--sb-text-muted);
  }
  .sb-uncol-sched-cancel:hover { color: var(--sb-text); background: var(--sb-surface); }
  .sb-uncol-sched-go {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-uncol-sched-go:hover:not(:disabled) { filter: brightness(0.95); }
  .sb-uncol-sched-go:disabled { background: var(--sb-surface-muted); color: var(--sb-text-muted); cursor: not-allowed; }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-uncol-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-uncol-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
