// =============================================================================
// 📚 Stonebooks — Batch Builder modal
// =============================================================================
// Opens when the operator clicks "Group into batch" with one or more cards
// selected. Captures kind / destination / scheduled date / worker / notes,
// surfaces trip suggestions in the right panel, and persists via
// createBatch on save. Build-only path leaves scheduled_date NULL so the
// batch lands in the tray (operator drags onto a day later).
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import {
  BATCH_KINDS,
  batchKindInfo,
  createBatch,
  getTripSuggestions,
  todayLocalISO,
  customerName,
} from '../../lib/stonebooksData'
import { TEAM_ROSTER } from '../../lib/team'
import TripSuggestionsPanel from './TripSuggestionsPanel'

export default function BatchBuilder({
  open,
  defaultKind,
  initialJobs,        // array of { job, milestone } from the Workbench selection
  cemeteries,
  allJobs,            // every actionable job — used by the optimizer
  onClose,
  onCreated,
}) {
  const [kind, setKind] = useState(defaultKind || 'inscription')
  const [title, setTitle] = useState('')
  const [destinationId, setDestinationId] = useState(null)
  const [scheduledDate, setScheduledDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [buildOnly, setBuildOnly] = useState(false)
  const [jobs, setJobs] = useState(initialJobs || [])   // [{ job, milestone? }]
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Reset every time the modal opens. defaultKind / initialJobs come fresh
  // each open so we re-seed from props.
  useEffect(() => {
    if (!open) return
    setKind(defaultKind || 'inscription')
    setTitle('')
    setDestinationId(_defaultDestinationFromJobs(initialJobs))
    setScheduledDate(todayLocalISO())
    setAssignedTo('')
    setNotes('')
    setBuildOnly(false)
    setJobs(initialJobs || [])
    setSubmitting(false)
    setError(null)
  }, [open, defaultKind, initialJobs])

  // Optimizer suggestions — recomputed whenever the destination or the
  // job set changes. Selected jobs are excluded so we don't suggest a
  // duplicate.
  const selectedIds = useMemo(
    () => new Set(jobs.map(j => j.job?.id).filter(Boolean)),
    [jobs],
  )
  const suggestions = useMemo(() => {
    if (!destinationId) return []
    return getTripSuggestions({
      cemetery_id: destinationId,
      currently_selected_job_ids: Array.from(selectedIds),
      jobs: allJobs || [],
      cemeteries: cemeteries || [],
    })
  }, [destinationId, selectedIds, allJobs, cemeteries])

  if (!open) return null

  const kindInfo = batchKindInfo(kind)
  const destinationCem = (cemeteries || []).find(c => c.id === destinationId) || null
  const requiresDestination = !!kindInfo.requiresDestination
  const canSave = jobs.length > 0
    && (!requiresDestination || !!destinationId)
    && (buildOnly || !!scheduledDate)

  const handleAdd = (job) => {
    if (!job?.id || selectedIds.has(job.id)) return
    setJobs(prev => [...prev, { job }])
  }
  const handleRemove = (jobId) => {
    setJobs(prev => prev.filter(j => j.job?.id !== jobId))
  }

  const handleSave = async () => {
    setError(null)
    setSubmitting(true)
    const res = await createBatch({
      kind,
      title: title || null,
      scheduled_date: buildOnly ? null : scheduledDate,
      destination_cemetery_id: requiresDestination ? destinationId : null,
      assigned_to: assignedTo || null,
      notes: notes || null,
      job_ids: jobs.map(j => j.job.id),
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error || 'Failed to create batch.')
      return
    }
    onCreated?.(res.batch)
    onClose?.()
  }

  return (
    <div className="sb-batch-builder-backdrop" onClick={onClose}>
      <div
        className="sb-batch-builder"
        role="dialog"
        aria-modal="true"
        aria-label="Create batch"
        onClick={e => e.stopPropagation()}
      >
        <header className="sb-batch-builder-head">
          <div className="sb-batch-builder-eyebrow">New batch</div>
          <h2 className="sb-batch-builder-title">
            {jobs.length === 1 ? '1 stop' : `${jobs.length} stops`} into one batch
          </h2>
        </header>

        <div className="sb-batch-builder-body">
          <div className="sb-batch-builder-form">
            <div className="sb-batch-builder-field">
              <label className="sb-batch-builder-label">Kind</label>
              <select
                className="sb-batch-builder-input"
                value={kind}
                onChange={e => setKind(e.target.value)}
                disabled={submitting}
              >
                {BATCH_KINDS.map(k => (
                  <option key={k.code} value={k.code}>{k.label}</option>
                ))}
              </select>
            </div>

            <div className="sb-batch-builder-field">
              <label className="sb-batch-builder-label">Title (optional)</label>
              <input
                type="text"
                className="sb-batch-builder-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={kindInfo.label}
                disabled={submitting}
              />
            </div>

            {requiresDestination && (
              <div className="sb-batch-builder-field">
                <label className="sb-batch-builder-label">Destination cemetery</label>
                <select
                  className="sb-batch-builder-input"
                  value={destinationId || ''}
                  onChange={e => setDestinationId(e.target.value || null)}
                  disabled={submitting}
                >
                  <option value="">— pick one —</option>
                  {(cemeteries || []).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="sb-batch-builder-row">
              <div className="sb-batch-builder-field">
                <label className="sb-batch-builder-label">Scheduled date</label>
                <input
                  type="date"
                  className="sb-batch-builder-input"
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  disabled={submitting || buildOnly}
                />
              </div>
              <div className="sb-batch-builder-field">
                <label className="sb-batch-builder-label">Assigned to</label>
                <select
                  className="sb-batch-builder-input"
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">— unassigned —</option>
                  {TEAM_ROSTER.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sb-batch-builder-field">
              <label className="sb-batch-builder-checkbox">
                <input
                  type="checkbox"
                  checked={buildOnly}
                  onChange={e => setBuildOnly(e.target.checked)}
                  disabled={submitting}
                />
                Build only — schedule later (lands in the tray)
              </label>
            </div>

            <div className="sb-batch-builder-field">
              <label className="sb-batch-builder-label">Notes (optional)</label>
              <textarea
                className="sb-batch-builder-input sb-batch-builder-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Special handling, plot notes, etc."
                rows={3}
                disabled={submitting}
              />
            </div>

            <div className="sb-batch-builder-stops">
              <div className="sb-batch-builder-label">Stops</div>
              <ul className="sb-batch-builder-stop-list">
                {jobs.map(({ job }, idx) => {
                  const surname = job.order?.primary_lastname
                    || customerName(job.order?.customer)
                    || '—'
                  const cem = job.order?.cemetery?.name || job.cemetery?.name
                  return (
                    <li key={job.id} className="sb-batch-builder-stop">
                      <span className="sb-batch-builder-stop-num">{idx + 1}.</span>
                      <span className="sb-batch-builder-stop-id">
                        <span className="sb-batch-builder-stop-name">{surname}</span>
                        {cem && (
                          <span className="sb-batch-builder-stop-cem">{cem}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="sb-batch-builder-stop-remove"
                        onClick={() => handleRemove(job.id)}
                        disabled={submitting}
                      >
                        remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {error && <div className="sb-batch-builder-error">{error}</div>}
          </div>

          <TripSuggestionsPanel
            suggestions={suggestions}
            destinationName={destinationCem?.name || null}
            onAdd={handleAdd}
          />
        </div>

        <footer className="sb-batch-builder-actions">
          <button
            type="button"
            className="sb-batch-builder-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sb-batch-builder-save"
            onClick={handleSave}
            disabled={submitting || !canSave}
          >
            {submitting
              ? 'Saving…'
              : buildOnly
                ? `Save to tray · ${jobs.length}`
                : `Schedule · ${jobs.length}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

// Pick a sensible default destination from the initial job set — if every
// selected job's cemetery agrees, use that. Otherwise leave NULL for the
// operator to choose explicitly.
function _defaultDestinationFromJobs(jobs) {
  if (!jobs || jobs.length === 0) return null
  const ids = new Set(jobs.map(j => j.job?.order?.cemetery_id || j.job?.cemetery?.id).filter(Boolean))
  if (ids.size === 1) return [...ids][0]
  return null
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-batch-builder-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow-y: auto;
  }
  .sb-batch-builder {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    width: 100%;
    max-width: 1080px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }
  .sb-batch-builder-head {
    padding: 28px 32px 16px;
  }
  .sb-batch-builder-eyebrow {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sb-text-muted);
    margin-bottom: 8px;
  }
  .sb-batch-builder-title {
    font-size: 22px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .sb-batch-builder-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    padding: 0 32px;
    overflow-y: auto;
  }
  .sb-batch-builder-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 24px;
  }
  .sb-batch-builder-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .sb-batch-builder-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sb-batch-builder-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--sb-text-muted);
  }
  .sb-batch-builder-input {
    font: inherit;
    font-size: 14px;
    padding: 8px 10px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 100%;
  }
  .sb-batch-builder-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-batch-builder-textarea {
    resize: vertical;
    min-height: 64px;
  }
  .sb-batch-builder-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--sb-text);
    cursor: pointer;
  }

  .sb-batch-builder-stops {
    margin-top: 4px;
  }
  .sb-batch-builder-stop-list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
  }
  .sb-batch-builder-stop {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 0.5px solid var(--sb-border);
  }
  .sb-batch-builder-stop:last-child {
    border-bottom: none;
  }
  .sb-batch-builder-stop-num {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-family: var(--sb-font-mono);
  }
  .sb-batch-builder-stop-id {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .sb-batch-builder-stop-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-batch-builder-stop-cem {
    font-size: 11px;
    color: var(--sb-text-muted);
  }
  .sb-batch-builder-stop-remove {
    background: transparent;
    border: none;
    color: var(--sb-text-muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
  }
  .sb-batch-builder-stop-remove:hover {
    color: var(--sb-red, #b54040);
  }

  .sb-batch-builder-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
  }

  .sb-batch-builder-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 32px 24px;
    border-top: 0.5px solid var(--sb-border);
  }
  .sb-batch-builder-cancel,
  .sb-batch-builder-save {
    font: inherit;
    font-size: 14px;
    padding: 8px 16px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-batch-builder-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-batch-builder-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-batch-builder-save {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-batch-builder-save:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-batch-builder-save:disabled,
  .sb-batch-builder-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 900px) {
    .sb-batch-builder-body {
      grid-template-columns: 1fr;
    }
    .sb-batch-builder-row {
      grid-template-columns: 1fr;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-batch-builder-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-batch-builder-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
