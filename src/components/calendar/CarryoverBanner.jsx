// =============================================================================
// 📚 Stonebooks — Carryover banner
// =============================================================================
// Top-of-Day banner. Surfaces stops from prior days whose batches were not
// completed. Operator picks one of three actions per stop:
//   • Mark complete   — sets completed_at on the original link row.
//   • Reschedule      — moves the stop to a target day via
//                        rescheduleBatchJobToDay (creates a target batch if
//                        none matches kind+destination+worker).
//   • Send back       — unscheduleBatchJob — deletes the link row;
//                        the underlying job re-surfaces in the Scheduler
//                        UnscheduledColumn next render.
//
// Copy tone: helpful, not scolding. "Carrying over from Tuesday" not
// "Tuesday's incomplete work."
// =============================================================================

import { useState } from 'react'
import {
  fmtDate,
  customerName,
  batchKindInfo,
  markBatchJobComplete,
  rescheduleBatchJobToDay,
  unscheduleBatchJob,
  todayLocalISO,
} from '../../lib/stonebooksData'

export default function CarryoverBanner({ rows, actorName, actorUserId, onReload }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  // (M) Cascade-failure visibility — same pattern as CalendarDayDispatch.
  // The link-row write succeeded but the milestone cascade was blocked or
  // failed; surface so the operator can manually flip the gated milestone.
  const [cascadeWarning, setCascadeWarning] = useState(null)
  const [rescheduleFor, setRescheduleFor] = useState(null)   // batch_job row
  const [rescheduleDate, setRescheduleDate] = useState(todayLocalISO())

  if (!rows || rows.length === 0) return null

  // Group rows by their original batch's scheduled_date so the banner reads
  // as "Carrying over from May 27 (2) · May 26 (1) · …" — operator sees
  // depth of slippage at a glance.
  const groups = _groupByDate(rows)

  const doMarkComplete = async (row) => {
    setBusyId(row.id)
    setError(null)
    setCascadeWarning(null)
    const res = await markBatchJobComplete(row.id, { actorName, actorUserId })
    setBusyId(null)
    if (!res.ok) {
      setError(res.error || 'Failed to mark complete.')
      return
    }
    if (res.warning) setCascadeWarning(res.warning)
    onReload?.()
  }
  const doUnschedule = async (row) => {
    setBusyId(row.id)
    setError(null)
    const res = await unscheduleBatchJob(row.id)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error || 'Failed to send back.')
      return
    }
    onReload?.()
  }
  const openReschedule = (row) => {
    setRescheduleFor(row)
    setRescheduleDate(todayLocalISO())
  }
  const confirmReschedule = async () => {
    if (!rescheduleFor || !rescheduleDate) return
    setBusyId(rescheduleFor.id)
    setError(null)
    const res = await rescheduleBatchJobToDay(rescheduleFor, rescheduleDate)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error || 'Failed to reschedule.')
      return
    }
    setRescheduleFor(null)
    onReload?.()
  }

  return (
    <section className="sb-carryover">
      <header className="sb-carryover-head">
        <span className="sb-carryover-title">
          Carrying over: {rows.length} {rows.length === 1 ? 'stop' : 'stops'}
        </span>
        <span className="sb-carryover-subline">
          {groups.map(g => `${fmtDate(g.iso)} (${g.rows.length})`).join(' · ')}
        </span>
      </header>
      {error && (
        <div className="sb-carryover-error">{error}</div>
      )}
      {cascadeWarning && !error && (
        <div className="sb-carryover-warning" role="status">
          <span className="sb-carryover-warning-label">Needs review</span>
          <span className="sb-carryover-warning-msg">{cascadeWarning}</span>
          <button
            type="button"
            className="sb-carryover-warning-dismiss"
            onClick={() => setCascadeWarning(null)}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      <ul className="sb-carryover-list">
        {rows.map(row => {
          const job = row.job
          const batch = row.batch
          const kindInfo = batchKindInfo(batch.kind)
          const surname = job?.order?.primary_lastname
            || customerName(job?.order?.customer)
            || '—'
          const cem = batch.cemetery?.name
            || job?.order?.cemetery?.name
            || job?.cemetery?.name
          const isBusy = busyId === row.id
          return (
            <li key={row.id} className="sb-carryover-row">
              <div className="sb-carryover-row-body">
                <div className="sb-carryover-row-primary">
                  <span className="sb-carryover-row-name">{surname}</span>
                  <span
                    className="sb-carryover-row-kind"
                    style={{ borderLeftColor: kindInfo.color }}
                  >
                    {kindInfo.label}
                  </span>
                  <span className="sb-carryover-row-from">
                    from {fmtDate(batch.scheduled_date)}
                  </span>
                </div>
                {cem && (
                  <div className="sb-carryover-row-cem">{cem}</div>
                )}
              </div>
              <div className="sb-carryover-row-actions">
                <button
                  type="button"
                  className="sb-carryover-action"
                  onClick={() => doMarkComplete(row)}
                  disabled={isBusy}
                >
                  Mark complete
                </button>
                <button
                  type="button"
                  className="sb-carryover-action"
                  onClick={() => openReschedule(row)}
                  disabled={isBusy}
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  className="sb-carryover-action sb-carryover-action-quiet"
                  onClick={() => doUnschedule(row)}
                  disabled={isBusy}
                >
                  Send back
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {rescheduleFor && (
        <RescheduleModal
          row={rescheduleFor}
          date={rescheduleDate}
          onDateChange={setRescheduleDate}
          onCancel={() => setRescheduleFor(null)}
          onConfirm={confirmReschedule}
          submitting={busyId === rescheduleFor.id}
        />
      )}
    </section>
  )
}

function RescheduleModal({ row, date, onDateChange, onCancel, onConfirm, submitting }) {
  const surname = row.job?.order?.primary_lastname || customerName(row.job?.order?.customer) || '—'
  return (
    <div className="sb-carryover-modal-backdrop" onClick={onCancel}>
      <div className="sb-carryover-modal" onClick={e => e.stopPropagation()}>
        <h3 className="sb-carryover-modal-title">Reschedule {surname}</h3>
        <p className="sb-carryover-modal-body">
          Move this stop to a new day. The original {fmtDate(row.batch.scheduled_date)} batch
          stays as-is for the audit trail.
        </p>
        <div className="sb-carryover-modal-field">
          <label className="sb-carryover-modal-label">New date</label>
          <input
            type="date"
            className="sb-carryover-modal-input"
            value={date}
            onChange={e => onDateChange(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="sb-carryover-modal-actions">
          <button
            type="button"
            className="sb-carryover-action sb-carryover-action-quiet"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sb-carryover-action sb-carryover-action-primary"
            onClick={onConfirm}
            disabled={submitting || !date}
          >
            {submitting ? 'Saving…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

function _groupByDate(rows) {
  const map = new Map()
  for (const r of rows) {
    const iso = String(r.batch?.scheduled_date || '').slice(0, 10)
    if (!iso) continue
    if (!map.has(iso)) map.set(iso, { iso, rows: [] })
    map.get(iso).rows.push(r)
  }
  return Array.from(map.values()).sort((a, b) => b.iso.localeCompare(a.iso))
}

const localStyles = `
  .sb-carryover {
    border: 0.5px solid var(--sb-amber, #b8842a);
    background: var(--sb-amber-bg, #fbe5b8);
    border-radius: var(--sb-r-sm, 6px);
    padding: 14px 18px;
    margin-bottom: 24px;
  }
  .sb-carryover-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .sb-carryover-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--sb-amber, #b8842a);
  }
  .sb-carryover-subline {
    font-size: 12px;
    color: var(--sb-text-muted);
  }
  .sb-carryover-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    margin-bottom: 8px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
  }
  /* (M) Cascade-failure visibility — amber notice, same pattern as
     CalendarDayDispatch. Operator sees this when the link-row write
     succeeded but the cascade was blocked / failed. */
  .sb-carryover-warning {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: var(--sb-amber-fg, #6b4a1c);
    background: var(--sb-amber-bg, #fbe5b8);
    border: 0.5px solid var(--sb-amber, #b8842a);
    font-size: 13px;
    padding: 10px 12px;
    margin-bottom: 8px;
    border-radius: var(--sb-r-sm, 6px);
    line-height: 1.4;
  }
  .sb-carryover-warning-label {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sb-amber, #b8842a);
    white-space: nowrap;
    padding-top: 1px;
  }
  .sb-carryover-warning-msg { flex: 1; }
  .sb-carryover-warning-dismiss {
    background: transparent;
    border: 0.5px solid var(--sb-amber, #b8842a);
    color: var(--sb-amber, #b8842a);
    font: inherit;
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .sb-carryover-warning-dismiss:hover { background: rgba(184, 132, 42, 0.12); }
  .sb-carryover-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sb-carryover-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.55);
    border-radius: var(--sb-r-sm, 6px);
    flex-wrap: wrap;
  }
  .sb-carryover-row-body {
    flex: 1;
    min-width: 0;
  }
  .sb-carryover-row-primary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sb-carryover-row-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--sb-text);
  }
  .sb-carryover-row-kind {
    font-size: 11px;
    color: var(--sb-text-muted);
    padding-left: 8px;
    border-left: 3px solid transparent;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-carryover-row-from {
    font-size: 11px;
    color: var(--sb-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sb-carryover-row-cem {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-top: 2px;
  }
  .sb-carryover-row-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .sb-carryover-action {
    background: var(--sb-surface);
    border: 0.5px solid var(--sb-border);
    color: var(--sb-text);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 12px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
  }
  .sb-carryover-action:hover:not(:disabled) {
    background: var(--sb-surface-muted);
  }
  .sb-carryover-action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .sb-carryover-action-quiet {
    color: var(--sb-text-muted);
  }
  .sb-carryover-action-primary {
    background: var(--sb-accent, #b8842a);
    border-color: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-carryover-action-primary:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  .sb-carryover-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 25, 0.42);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .sb-carryover-modal {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    max-width: 420px;
    padding: 24px 28px;
  }
  .sb-carryover-modal-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0 0 8px;
  }
  .sb-carryover-modal-body {
    font-size: 13px;
    color: var(--sb-text-secondary);
    line-height: 1.5;
    margin: 0 0 16px;
  }
  .sb-carryover-modal-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
  }
  .sb-carryover-modal-label {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 500;
  }
  .sb-carryover-modal-input {
    font: inherit;
    font-size: 14px;
    padding: 8px 10px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
  }
  .sb-carryover-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-carryover-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-carryover-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
