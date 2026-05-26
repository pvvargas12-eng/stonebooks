// =============================================================================
// 📚 Stonebooks — Bulk Order Row
// =============================================================================
// One row in the Admin "Open bulk orders" bucket. Surfaces one active PO:
//   supplier · kind · PO# · jobs riding · placed/ETA · Mark received
//
// Distinct from JobsQueueRow because the unit is a bulk_order, not a
// milestone. Click-through is "Mark received" — the only operational action
// the row needs, and it cascades to every linked milestone via the data
// layer's markBulkOrderReceived helper.
// =============================================================================

import { useState } from 'react'
import { URGENCY, fmtDate } from '../lib/stonebooksData'

const URGENCY_ROW_TINT = {
  [URGENCY.NEUTRAL]: 'transparent',
  [URGENCY.AMBER]:   'rgba(184, 132, 42, 0.045)',
  [URGENCY.RED]:     'rgba(181, 64, 64, 0.055)',
}

const KIND_LABELS = {
  stone:   'Stone',
  photo:   'Photo',
  etching: 'Etching',
  bronze:  'Bronze',
}

export default function BulkOrderRow({ row, onMarkReceived }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const bo = row.bulkOrder
  const urgency = row.urgency || URGENCY.NEUTRAL

  // Status pill text — operator-friendly "X days past ETA" when red, plain
  // "Open" otherwise. Mirrors the JobsQueueRow pill vocabulary.
  let statusLabel = 'Open'
  let statusColor = 'var(--sb-text-muted)'
  let statusBg = 'transparent'
  if (urgency === URGENCY.RED && row.overdueDays > 0) {
    statusLabel = `${row.overdueDays}d past ETA`
    statusColor = 'var(--sb-red, #b54040)'
    statusBg = 'var(--sb-red-bg, #fbe5e5)'
  } else if (urgency === URGENCY.AMBER) {
    statusLabel = `Aging · ${row.placedAge ?? 0}d`
    statusColor = 'var(--sb-amber, #b8842a)'
    statusBg = 'var(--sb-amber-bg, #fbe5b8)'
  }

  const handleMarkReceived = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await onMarkReceived?.(bo.id)
      if (res && res.ok === false) {
        setError(res.error || 'Failed to mark received')
      }
    } catch (e) {
      setError(e?.message || 'Failed to mark received')
    } finally {
      setBusy(false)
    }
  }

  // Identity line — supplier + kind chip + PO number (when present).
  const kindLabel = KIND_LABELS[bo.kind] || bo.kind
  const idTrail = []
  if (bo.po_number) idTrail.push(`PO ${bo.po_number}`)
  idTrail.push(`${row.linkedCount} job${row.linkedCount === 1 ? '' : 's'}`)
  if (bo.placed_at) idTrail.push(`placed ${fmtDate(bo.placed_at)}`)
  if (bo.supplier_eta) idTrail.push(`ETA ${fmtDate(bo.supplier_eta)}`)

  return (
    <div
      className={`sb-bulk-row sb-bulk-row-${urgency}`}
      style={{ background: URGENCY_ROW_TINT[urgency] }}
    >
      <div className="sb-bulk-row-identity">
        <div className="sb-bulk-row-primary">
          <span className="sb-bulk-row-supplier">{bo.supplier_name}</span>
          <span className="sb-bulk-row-kind">{kindLabel}</span>
        </div>
        <div className="sb-bulk-row-secondary">{idTrail.join(' · ')}</div>
        {bo.po_file_url && (
          <div className="sb-bulk-row-secondary">
            <a
              href={bo.po_file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="sb-bulk-row-pofile"
              onClick={e => e.stopPropagation()}
            >
              View PO file
            </a>
          </div>
        )}
        {error && (
          <div className="sb-bulk-row-error">{error}</div>
        )}
      </div>

      <div className="sb-bulk-row-status">
        <span
          className="sb-bulk-row-pill"
          style={{
            color: statusColor,
            background: statusBg,
            borderColor: urgency === URGENCY.NEUTRAL ? 'var(--sb-border)' : 'transparent',
          }}
        >
          {statusLabel}
        </span>
      </div>

      <div className="sb-bulk-row-actions">
        <button
          type="button"
          className="sb-bulk-row-receive"
          onClick={handleMarkReceived}
          disabled={busy}
        >
          {busy ? 'Marking…' : 'Mark received'}
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-bulk-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px 140px;
    gap: 16px;
    align-items: center;
    width: 100%;
    padding: 14px 18px;
    border-bottom: 0.5px solid var(--sb-border);
    text-align: left;
  }
  .sb-bulk-row:last-child {
    border-bottom: none;
  }

  .sb-bulk-row-identity {
    min-width: 0;
  }
  .sb-bulk-row-primary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .sb-bulk-row-supplier {
    font-size: 15px;
    font-weight: 500;
    color: var(--sb-text);
    letter-spacing: -0.005em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sb-bulk-row-kind {
    font-size: 11px;
    font-weight: 500;
    color: var(--sb-text-muted);
    background: var(--sb-surface-muted);
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sb-bulk-row-secondary {
    font-size: 12px;
    color: var(--sb-text-muted);
    margin-top: 3px;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  .sb-bulk-row-pofile {
    color: var(--sb-accent, #b8842a);
    text-decoration: underline;
    text-decoration-color: var(--sb-border);
    font-size: 12px;
  }
  .sb-bulk-row-pofile:hover {
    text-decoration-color: var(--sb-accent, #b8842a);
  }
  .sb-bulk-row-error {
    margin-top: 4px;
    font-size: 12px;
    color: var(--sb-red, #b54040);
  }

  .sb-bulk-row-status {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sb-bulk-row-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    border: 0.5px solid transparent;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.4;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .sb-bulk-row-actions {
    display: flex;
    justify-content: flex-end;
  }
  .sb-bulk-row-receive {
    font: inherit;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid var(--sb-border);
    background: var(--sb-surface);
    color: var(--sb-text);
  }
  .sb-bulk-row-receive:hover:not(:disabled) {
    background: var(--sb-surface-muted);
  }
  .sb-bulk-row-receive:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .sb-bulk-row {
      grid-template-columns: minmax(0, 1fr) 120px;
      gap: 12px;
      padding: 12px 14px;
    }
    .sb-bulk-row-actions {
      grid-column: 1 / -1;
      justify-content: flex-start;
    }
    .sb-bulk-row-status {
      justify-content: flex-start;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-bulk-row-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-bulk-row-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
