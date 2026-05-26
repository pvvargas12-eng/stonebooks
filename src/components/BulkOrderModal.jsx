// =============================================================================
// 📚 Stonebooks — Bulk Order Modal
// =============================================================================
// Captures supplier + PO details for a new bulk_order spanning N selected
// milestones. Opens from the multi-select action bar on Admin's "Stones to
// order" and "Photos to request" queues. On save: creates the bulk_orders
// row, links each selected milestone via bulk_order_id, and flips each
// milestone to in_progress (the order is now placed).
//
// PO file upload: graceful degradation. If Supabase Storage isn't wired (or
// the upload errors), the bulk_order saves WITHOUT the file URL and the
// operator is told. This is the spec's explicit guidance — never block the
// PO creation on storage.
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import {
  BULK_ORDER_KINDS,
  createBulkOrder,
  todayLocalISO,
} from '../lib/stonebooksData'
import { supabase } from '../lib/supabase'

// Storage bucket name for PO PDFs. The bucket is created by the operator in
// Supabase Studio; if it doesn't exist yet, uploads no-op and the bulk order
// is still created. Keep this name in sync with whatever Paul provisions.
const PO_STORAGE_BUCKET = 'bulk-order-pos'

export default function BulkOrderModal({
  open,
  defaultKind = 'stone',
  selectedRows = [],
  onClose,
  onCreated,
}) {
  const [kind, setKind] = useState(defaultKind)
  const [supplierName, setSupplierName] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [placedAt, setPlacedAt] = useState(todayLocalISO())
  const [supplierEta, setSupplierEta] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const fileInputRef = useRef(null)

  // Reset form whenever the modal opens. The defaultKind comes in fresh on
  // each open (it varies by which queue opened it — stones vs photos).
  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setSupplierName('')
    setPoNumber('')
    setPlacedAt(todayLocalISO())
    setSupplierEta('')
    setNotes('')
    setFile(null)
    setError(null)
    setWarning(null)
    setSubmitting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open, defaultKind])

  if (!open) return null

  // Attempt to upload the PO file. Returns { url, warning } where warning is
  // populated when storage isn't wired or the upload failed (and the caller
  // proceeds without a file). Empty path = no file selected.
  const _maybeUpload = async () => {
    if (!file) return { url: null, warning: null }
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const path = `${Date.now()}_${safeName}`
    try {
      const { error: upErr } = await supabase.storage
        .from(PO_STORAGE_BUCKET)
        .upload(path, file, { upsert: false })
      if (upErr) {
        return {
          url: null,
          warning: `PO file not attached (${upErr.message}). The bulk order was still created.`,
        }
      }
      const { data: urlData } = supabase.storage
        .from(PO_STORAGE_BUCKET)
        .getPublicUrl(path)
      return { url: urlData?.publicUrl || null, warning: null }
    } catch (e) {
      return {
        url: null,
        warning: `PO file not attached (${e?.message || 'storage unavailable'}). The bulk order was still created.`,
      }
    }
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    setError(null)
    setWarning(null)
    const trimmedSupplier = supplierName.trim()
    if (!trimmedSupplier) {
      setError('Supplier name is required.')
      return
    }
    if (!placedAt) {
      setError('Placed date is required.')
      return
    }
    setSubmitting(true)

    // Try the file upload first (graceful — never blocks bulk order creation).
    const { url, warning: uploadWarn } = await _maybeUpload()

    const res = await createBulkOrder({
      kind,
      supplier_name: trimmedSupplier,
      po_number:     poNumber.trim() || null,
      placed_at:     placedAt,
      supplier_eta:  supplierEta || null,
      notes:         notes.trim() || null,
      po_file_url:   url,
      milestoneIds:  selectedRows.map(r => r.milestone?.id).filter(Boolean),
    })

    setSubmitting(false)
    if (!res.ok) {
      setError(res.error || 'Failed to create bulk order.')
      return
    }
    if (uploadWarn) setWarning(uploadWarn)
    onCreated?.(res.bulkOrder)
    // The parent typically reloads then closes the modal; we don't auto-close
    // when there's a warning so the operator sees the partial-success copy.
    if (!uploadWarn) onClose?.()
  }

  const count = selectedRows.length

  return (
    <div className="sb-bulk-modal-backdrop" onClick={onClose}>
      <div
        className="sb-bulk-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add to bulk order"
        onClick={e => e.stopPropagation()}
      >
        <header className="sb-bulk-modal-head">
          <div className="sb-bulk-modal-eyebrow">Add to bulk order</div>
          <h2 className="sb-bulk-modal-title">
            {count === 1 ? '1 milestone' : `${count} milestones`} into one PO
          </h2>
        </header>

        <form onSubmit={handleSubmit} className="sb-bulk-modal-form">
          <div className="sb-bulk-modal-field">
            <label className="sb-bulk-modal-label">Kind</label>
            <select
              className="sb-bulk-modal-input"
              value={kind}
              onChange={e => setKind(e.target.value)}
              disabled={submitting}
            >
              {BULK_ORDER_KINDS.map(k => (
                <option key={k.code} value={k.code}>{k.label}</option>
              ))}
            </select>
          </div>

          <div className="sb-bulk-modal-field">
            <label className="sb-bulk-modal-label">Supplier</label>
            <input
              type="text"
              className="sb-bulk-modal-input"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              placeholder="e.g. Coldspring"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="sb-bulk-modal-row">
            <div className="sb-bulk-modal-field">
              <label className="sb-bulk-modal-label">PO number (optional)</label>
              <input
                type="text"
                className="sb-bulk-modal-input"
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="e.g. PO-4427"
                disabled={submitting}
              />
            </div>
            <div className="sb-bulk-modal-field">
              <label className="sb-bulk-modal-label">Placed</label>
              <input
                type="date"
                className="sb-bulk-modal-input"
                value={placedAt}
                onChange={e => setPlacedAt(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="sb-bulk-modal-field">
              <label className="sb-bulk-modal-label">Supplier ETA</label>
              <input
                type="date"
                className="sb-bulk-modal-input"
                value={supplierEta}
                onChange={e => setSupplierEta(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="sb-bulk-modal-field">
            <label className="sb-bulk-modal-label">PO file (optional)</label>
            <input
              ref={fileInputRef}
              type="file"
              className="sb-bulk-modal-input"
              accept="application/pdf,image/*"
              onChange={e => setFile(e.target.files?.[0] || null)}
              disabled={submitting}
            />
            <div className="sb-bulk-modal-hint">
              Saved to Supabase Storage when available. If storage isn't wired,
              the bulk order is still created without the file.
            </div>
          </div>

          <div className="sb-bulk-modal-field">
            <label className="sb-bulk-modal-label">Notes (optional)</label>
            <textarea
              className="sb-bulk-modal-input sb-bulk-modal-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything the receiver should know — special handling, partial shipments, etc."
              rows={3}
              disabled={submitting}
            />
          </div>

          {error && <div className="sb-bulk-modal-error">{error}</div>}
          {warning && <div className="sb-bulk-modal-warning">{warning}</div>}

          <div className="sb-bulk-modal-actions">
            <button
              type="button"
              className="sb-bulk-modal-cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="sb-bulk-modal-save"
              disabled={submitting || count === 0}
            >
              {submitting ? 'Saving…' : `Create PO · ${count}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const localStyles = `
  .sb-bulk-modal-backdrop {
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
  .sb-bulk-modal {
    background: var(--sb-surface);
    border-radius: var(--sb-r-md, 10px);
    box-shadow: 0 16px 48px rgba(15, 20, 25, 0.24);
    width: 100%;
    max-width: 560px;
    padding: 32px;
  }
  .sb-bulk-modal-head {
    margin-bottom: 24px;
  }
  .sb-bulk-modal-eyebrow {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--sb-text-muted);
    margin-bottom: 8px;
  }
  .sb-bulk-modal-title {
    font-size: 22px;
    font-weight: 500;
    color: var(--sb-text);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .sb-bulk-modal-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .sb-bulk-modal-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }
  .sb-bulk-modal-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sb-bulk-modal-label {
    font-size: 12px;
    color: var(--sb-text-muted);
    font-weight: 500;
  }
  .sb-bulk-modal-input {
    font: inherit;
    font-size: 14px;
    padding: 8px 10px;
    border: 0.5px solid var(--sb-border);
    border-radius: var(--sb-r-sm, 6px);
    background: var(--sb-surface);
    color: var(--sb-text);
    width: 100%;
  }
  .sb-bulk-modal-input:focus {
    outline: none;
    border-color: var(--sb-accent, #b8842a);
    box-shadow: 0 0 0 2px var(--sb-accent-bg, rgba(184, 132, 42, 0.15));
  }
  .sb-bulk-modal-textarea {
    resize: vertical;
    min-height: 64px;
  }
  .sb-bulk-modal-hint {
    font-size: 11px;
    color: var(--sb-text-muted);
    margin-top: 2px;
    line-height: 1.4;
  }
  .sb-bulk-modal-error {
    color: var(--sb-red, #b54040);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-red-bg, #fbe5e5);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-bulk-modal-warning {
    color: var(--sb-amber, #b8842a);
    font-size: 13px;
    padding: 8px 10px;
    background: var(--sb-amber-bg, #fbe5b8);
    border-radius: var(--sb-r-sm, 6px);
  }
  .sb-bulk-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .sb-bulk-modal-cancel,
  .sb-bulk-modal-save {
    font: inherit;
    font-size: 14px;
    padding: 8px 16px;
    border-radius: var(--sb-r-sm, 6px);
    cursor: pointer;
    font-weight: 500;
    border: 0.5px solid transparent;
  }
  .sb-bulk-modal-cancel {
    background: transparent;
    color: var(--sb-text-muted);
    border-color: var(--sb-border);
  }
  .sb-bulk-modal-cancel:hover {
    color: var(--sb-text);
    background: var(--sb-surface-muted);
  }
  .sb-bulk-modal-save {
    background: var(--sb-accent, #b8842a);
    color: white;
  }
  .sb-bulk-modal-save:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .sb-bulk-modal-save:disabled,
  .sb-bulk-modal-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .sb-bulk-modal {
      padding: 24px 20px;
    }
    .sb-bulk-modal-row {
      grid-template-columns: 1fr;
    }
  }
`

if (typeof document !== 'undefined' && !document.getElementById('sb-bulk-modal-styles')) {
  const tag = document.createElement('style')
  tag.id = 'sb-bulk-modal-styles'
  tag.textContent = localStyles
  document.head.appendChild(tag)
}
