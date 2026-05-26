// =============================================================================
// 📚 Stonebooks — Add Event Modal
// =============================================================================
// Custom-event creation surface. Zero-job batches that live on the calendar
// as ad-hoc entries — site visits, customer-home meetings, parts errands,
// paperwork drops. Two kinds today: site_visit and errand. Both isField=true
// + requiresDestination=false, so the cemetery picker is optional and a free-
// text address field is exposed for non-cemetery destinations.
//
// Defaults to site_visit because that's the more common case (estimate
// walk-throughs).
// =============================================================================

import { useEffect, useState } from 'react'
import {
  createBatch,
  todayLocalISO,
  BATCH_KINDS,
} from '../lib/stonebooksData'
import { TEAM_ROSTER } from '../lib/team'

// Kinds the modal lets the operator pick from. We intentionally limit the
// dropdown to the two event kinds even though createBatch accepts all 11 —
// the workflow kinds (inscription, blasting, etc.) are created from the
// Scheduler workbench, not from this modal.
const EVENT_KINDS = ['site_visit', 'errand']

export default function AddEventModal({
  open,
  cemeteries,
  defaultDate,
  onClose,
  onCreated,
}) {
  const [kind, setKind] = useState('site_visit')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate || todayLocalISO())
  const [destinationId, setDestinationId] = useState('')
  const [address, setAddress] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Reset on each open. Pre-fill the date from whatever the parent passes
  // (Day view passes the focused day; Week view passes today).
  useEffect(() => {
    if (!open) return
    setKind('site_visit')
    setTitle('')
    setDate(defaultDate || todayLocalISO())
    setDestinationId('')
    setAddress('')
    setAssignedTo('')
    setNotes('')
    setSubmitting(false)
    setError(null)
  }, [open, defaultDate])

  if (!open) return null

  const kindInfo = BATCH_KINDS.find(k => k.code === kind)
  const canSave = !!title.trim() && !!date && !submitting

  const handleSave = async () => {
    setError(null)
    setSubmitting(true)
    // Address + cemetery: we tuck address into notes when the operator
    // typed one, since the schema doesn't carry a separate address column
    // on the batch. Cemetery still goes into destination_cemetery_id when
    // picked. If both are present, notes get both.
    const notesParts = []
    if (address.trim()) notesParts.push(`Address: ${address.trim()}`)
    if (notes.trim())   notesParts.push(notes.trim())
    const combinedNotes = notesParts.join('\n\n') || null

    const res = await createBatch({
      kind,
      title: title.trim(),
      scheduled_date: date,
      destination_cemetery_id: destinationId || null,
      assigned_to: assignedTo || null,
      notes: combinedNotes,
      job_ids: [],   // zero-job batch — this is the whole point
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error || 'Failed to create event.')
      return
    }
    onCreated?.(res.batch)
    onClose?.()
  }

  return (
    <div className="sb-add-event-backdrop" onClick={onClose}>
      <div
        className="sb-add-event"
        role="dialog"
        aria-modal="true"
        aria-label="Add calendar event"
        onClick={e => e.stopPropagation()}
      >
        <header className="sb-add-event-head">
          <div className="sb-add-event-eyebrow">New calendar event</div>
          <h3 className="sb-add-event-title">Add an event</h3>
          <p className="sb-add-event-sub">
            For ad-hoc work that isn't tied to a job — estimate walks, customer
            meetings, parts pickups. Lands on the calendar like any other batch.
          </p>
        </header>

        <div className="sb-add-event-row">
          <div className="sb-add-event-field">
            <label className="sb-add-event-label">Kind</label>
            <select
              className="sb-add-event-input"
              value={kind}
              onChange={e => setKind(e.target.value)}
              disabled={submitting}
            >
              {EVENT_KINDS.map(k => {
                const info = BATCH_KINDS.find(b => b.code === k)
                return (
                  <option key={k} value={k}>{info?.label || k}</option>
                )
              })}
            </select>
          </div>
          <div className="sb-add-event-field">
            <label className="sb-add-event-label">Date</label>
            <input
              type="date"
              className="sb-add-event-input"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="sb-add-event-field">
          <label className="sb-add-event-label">Title</label>
          <input
            type="text"
            className="sb-add-event-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={kindInfo?.code === 'site_visit'
              ? 'e.g. Smith estimate walk-through'
              : 'e.g. Pick up granite samples at Coldspring'}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div className="sb-add-event-row">
          <div className="sb-add-event-field">
            <label className="sb-add-event-label">Cemetery (optional)</label>
            <select
              className="sb-add-event-input"
              value={destinationId}
              onChange={e => setDestinationId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— none —</option>
              {(cemeteries || []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="sb-add-event-field">
            <label className="sb-add-event-label">Assigned to</label>
            <select
              className="sb-add-event-input"
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

        <div className="sb-add-event-field">
          <label className="sb-add-event-label">Address (optional)</label>
          <input
            type="text"
            className="sb-add-event-input"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Used when destination isn't a cemetery (customer home, supplier, etc.)"
            disabled={submitting}
          />
        </div>

        <div className="sb-add-event-field">
          <label className="sb-add-event-label">Notes (optional)</label>
          <textarea
            className="sb-add-event-input sb-add-event-textarea"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything the crew chief should know."
            rows={3}
            disabled={submitting}
          />
        </div>

        {error && <div className="sb-add-event-error">{error}</div>}

        <div className="sb-add-event-actions">
          <button
            type="button"
            className="sb-add-event-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sb-add-event-save"
            onClick={handleSave}
            disabled={!canSave}
          >
            {submitting ? 'Saving…' : 'Save event'}
          </button>
        </div>
      </div>
    </div>
  )
}

const localStyles = `
  .sb-add-event-backdrop {
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
  .sb-add-event {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    width: 100%;
    max-width: 520px;
    padding: 28px 32px 24px;
  }
  .sb-add-event-head {
    margin-bottom: 18px;
  }
  .sb-add-event-eyebrow {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sb-text-muted);
    margin-bottom: 6px;
  }
  .sb-add-event-title {
    font-size: 20px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 6px;
    letter-spacing: -0.005em;
  }
  .sb-add-event-sub {
    font-size: 13px;
    color: var(--sb-text-secondary);
    line-height: 1.5;
    margin: 0;
    max-width: 44ch;
  }
  .sb-add-event-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .sb-add-event-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .sb-add-event-label {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 500;
  }
  .sb-add-event-input {
    font: inherit;
    font-size: 14px;
    padding: 9px 12px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 100%;
  }
  .sb-add-event-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-add-event-textarea {
    resize: vertical;
    min-height: 70px;
  }
  .sb-add-event-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
    margin-bottom: 12px;
  }
  .sb-add-event-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .sb-add-event-cancel,
  .sb-add-event-save {
    font: inherit;
    font-size: 14px;
    padding: 8px 18px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-add-event-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-add-event-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-add-event-save {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-add-event-save:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-add-event-cancel:disabled,
  .sb-add-event-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .sb-add-event-row {
      grid-template-columns: 1fr;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-add-event-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-add-event-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
