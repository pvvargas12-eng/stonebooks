// =============================================================================
// 📚 Stonebooks — Add Promise Modal
// =============================================================================
// Two modes:
//   • Pre-filled  — caller passes `jobId` + `jobLabel`; the modal skips
//                    search and lets the operator pick promiser + date.
//   • Search-first — caller passes no jobId; the modal opens with a search
//                    input. Once a job is chosen, the search collapses
//                    into a quiet preview and the form fields reveal.
//
// The 🤡 is the only emoji in the app, and it earns its place here: the
// modal title carries it so the operator's eye lands on the operational
// gravity of what they're about to commit to.
// =============================================================================

import { useEffect, useState, useMemo } from 'react'
import {
  addPromise,
  todayLocalISO,
} from '../lib/stonebooksData'
import {
  refreshEntityIndex,
  buildResults,
} from '../lib/commandSurface'
import { TEAM_ROSTER, DEFAULT_PROMISE_MAKER } from '../lib/team'

export default function AddPromiseModal({
  open,
  jobId: pinnedJobId,            // when supplied, search is skipped
  jobLabel: pinnedJobLabel,      // quiet display label when pinned
  onClose,
  onSaved,
}) {
  const isPinned = !!pinnedJobId

  // When the modal opens unpinned, we show a job search. Once a job is
  // picked it stores into `selectedJob` and the search input collapses.
  // When pinned, `selectedJob` is the pinned-job summary the parent passed.
  const [selectedJob, setSelectedJob] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  const [promisedBy, setPromisedBy] = useState(DEFAULT_PROMISE_MAKER)
  const [promisedDate, setPromisedDate] = useState(todayLocalISO())
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Reset on each open. Refresh the entity index so search results are
  // fresh — refreshEntityIndex de-dupes concurrent calls so this is cheap.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setSelectedJob(isPinned ? { id: pinnedJobId, label: pinnedJobLabel || 'this job' } : null)
    setPromisedBy(DEFAULT_PROMISE_MAKER)
    setPromisedDate(todayLocalISO())
    setNotes('')
    setError(null)
    setSubmitting(false)
    if (!isPinned) {
      refreshEntityIndex().catch(() => { /* silent — search just stays empty */ })
    }
  }, [open, isPinned, pinnedJobId, pinnedJobLabel])

  // Recompute search results on every keystroke. buildResults caps at
  // MAX_RESULTS (10) internally so the dropdown stays short.
  useEffect(() => {
    if (isPinned || !open) return
    const rows = buildResults(query)
      .filter(r => r.kind === 'entity-job')
    setResults(rows)
  }, [query, open, isPinned])

  const titleCustomer = useMemo(() => {
    if (!selectedJob) return null
    return selectedJob.label || 'this job'
  }, [selectedJob])

  if (!open) return null

  const handleSave = async () => {
    if (!selectedJob?.id) {
      setError('Pick a job first.')
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await addPromise(selectedJob.id, {
      promised_by:   promisedBy,
      promised_date: promisedDate,
      notes:         notes.trim() || null,
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error || 'Failed to save promise.')
      return
    }
    onSaved?.(res.promise)
  }

  return (
    <div className="sb-add-promise-backdrop" onClick={onClose}>
      <div
        className="sb-add-promise"
        role="dialog"
        aria-modal="true"
        aria-label="Add promise"
        onClick={e => e.stopPropagation()}
      >
        <header className="sb-add-promise-head">
          <span className="sb-add-promise-icon" aria-hidden="true">🤡</span>
          <div>
            <h3 className="sb-add-promise-title">
              {isPinned ? 'Mark as promised' : 'Add a promise'}
            </h3>
            <p className="sb-add-promise-sub">
              Capture who promised what and when. The job will carry the
              🤡 treatment until the promise is resolved.
            </p>
          </div>
        </header>

        {!isPinned && !selectedJob && (
          <div className="sb-add-promise-field">
            <label className="sb-add-promise-label">Find the job</label>
            <input
              type="text"
              autoFocus
              className="sb-add-promise-input"
              placeholder="Type a surname, cemetery, or order number"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && results.length === 0 && (
              <div className="sb-add-promise-empty">No matches for "{query}".</div>
            )}
            {results.length > 0 && (
              <ul className="sb-add-promise-results">
                {results.map(r => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="sb-add-promise-result"
                      onClick={() => setSelectedJob({ id: r.entity?.id, label: r.label })}
                    >
                      <span className="sb-add-promise-result-label">{r.label}</span>
                      {r.sublabel && (
                        <span className="sb-add-promise-result-sub">{r.sublabel}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {selectedJob && (
          <>
            {!isPinned && (
              <div className="sb-add-promise-pinned">
                <span className="sb-add-promise-pinned-label">Job</span>
                <span className="sb-add-promise-pinned-name">{titleCustomer}</span>
                <button
                  type="button"
                  className="sb-add-promise-pinned-change"
                  onClick={() => setSelectedJob(null)}
                >
                  Change
                </button>
              </div>
            )}

            <div className="sb-add-promise-row">
              <div className="sb-add-promise-field">
                <label className="sb-add-promise-label">Promised by</label>
                <select
                  className="sb-add-promise-input"
                  value={promisedBy}
                  onChange={e => setPromisedBy(e.target.value)}
                  disabled={submitting}
                >
                  {TEAM_ROSTER.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="sb-add-promise-field">
                <label className="sb-add-promise-label">Promised date</label>
                <input
                  type="date"
                  className="sb-add-promise-input"
                  value={promisedDate}
                  onChange={e => setPromisedDate(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="sb-add-promise-field">
              <label className="sb-add-promise-label">Notes (optional)</label>
              <textarea
                className="sb-add-promise-input sb-add-promise-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What did the customer ask for? Any context the team should know?"
                rows={3}
                disabled={submitting}
              />
            </div>

            {error && <div className="sb-add-promise-error">{error}</div>}

            <div className="sb-add-promise-actions">
              <button
                type="button"
                className="sb-add-promise-cancel"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sb-add-promise-save"
                onClick={handleSave}
                disabled={submitting || !promisedBy || !promisedDate}
              >
                {submitting ? 'Saving…' : 'Save promise'}
              </button>
            </div>
          </>
        )}

        {!isPinned && !selectedJob && (
          <div className="sb-add-promise-actions">
            <button
              type="button"
              className="sb-add-promise-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-add-promise-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .sb-add-promise {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    width: 100%;
    max-width: 520px;
    padding: 28px 32px 24px;
  }

  .sb-add-promise-head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .sb-add-promise-icon {
    font-size: 32px;
    line-height: 1;
  }
  .sb-add-promise-title {
    font-size: 18px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0;
    letter-spacing: -0.005em;
  }
  .sb-add-promise-sub {
    font-size: 13px;
    color: var(--sb-text-secondary);
    line-height: 1.55;
    margin: 6px 0 0;
    max-width: 42ch;
  }

  .sb-add-promise-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 14px;
  }
  .sb-add-promise-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 14px;
  }
  .sb-add-promise-label {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 500;
  }
  .sb-add-promise-input {
    font: inherit;
    font-size: 14px;
    padding: 9px 12px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-add-promise-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-add-promise-textarea {
    resize: vertical;
    min-height: 70px;
  }

  .sb-add-promise-results {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    overflow: hidden;
    max-height: 260px;
    overflow-y: auto;
  }
  .sb-add-promise-result {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 0.5px solid var(--sb-border);
    padding: 8px 12px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background 0.12s;
  }
  .sb-add-promise-result:last-child {
    border-bottom: none;
  }
  .sb-add-promise-result:hover {
    background: var(--sb-surface-muted);
  }
  .sb-add-promise-result-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-add-promise-result-sub {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
  }
  .sb-add-promise-empty {
    font-size: 13px;
    color: var(--sb-text-muted);
    padding: 8px 4px;
    font-style: italic;
  }

  .sb-add-promise-pinned {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
    background: var(--sb-surface-muted);
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    margin-bottom: 14px;
  }
  .sb-add-promise-pinned-label {
    font-size: 11px;
    color: var(--sb-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-add-promise-pinned-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--sb-text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sb-add-promise-pinned-change {
    background: transparent;
    border: none;
    color: var(--sb-accent, #b8842a);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
  }
  .sb-add-promise-pinned-change:hover {
    text-decoration: underline;
  }

  .sb-add-promise-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
    margin-bottom: 12px;
  }
  .sb-add-promise-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sb-add-promise-cancel,
  .sb-add-promise-save {
    font: inherit;
    font-size: 14px;
    padding: 8px 18px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-add-promise-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-add-promise-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-add-promise-save {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-add-promise-save:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-add-promise-cancel:disabled,
  .sb-add-promise-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-add-promise-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-add-promise-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
