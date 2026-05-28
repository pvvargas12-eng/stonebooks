// =============================================================================
// Stonebooks — Add Expense modal (shared)
// =============================================================================
// Records an expense_incurred row. Used in two places with the same data path:
//   • JobDetail expenses panel — link is preset to the job (no picker).
//   • Profit tab expenses section — showPicker lets the operator attach the
//     expense to a job, family order, cemetery order, or general overhead.
// Required fields: amount + category (Monument Operations Architect: keep entry
// fast). Receipt upload is optional → private `receipts` bucket.
// =============================================================================

import { useState, useEffect } from 'react'
import {
  recordExpense,
  uploadReceipt,
  EXPENSE_CATEGORIES,
  getJobs,
  getCemeteryOrders,
  listAllOrders,
  customerName,
} from '../lib/stonebooksData'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ExpenseModal({ presetLink = null, presetLabel = '', showPicker = false, onClose, onSaved }) {
  // link value encodes type+id: 'overhead' | `job:ID` | `order:ID` | `cemetery:ID`
  const [link, setLink] = useState(presetLink || 'overhead')
  const [opts, setOpts] = useState({ jobs: [], orders: [], cemetery: [] })
  const [form, setForm] = useState({ amount: '', category: 'material', vendor: '', description: '', date: todayISO(), notes: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!showPicker) return
    let cancelled = false
    Promise.all([getJobs({ includeClosed: false, limit: 300 }), getCemeteryOrders(), listAllOrders()]).then(([jobs, cem, orders]) => {
      if (cancelled) return
      setOpts({ jobs: jobs || [], cemetery: cem || [], orders: orders || [] })
    })
    return () => { cancelled = true }
  }, [showPicker])

  const amt = Number(form.amount)
  const valid = Number.isFinite(amt) && amt > 0 && !!form.category

  const resolveLink = () => {
    if (link === 'overhead' || !link) return {}
    const [type, id] = link.split(':')
    if (type === 'job') return { jobId: id }
    if (type === 'order') return { orderId: id }
    if (type === 'cemetery') return { cemeteryOrderId: id }
    return {}
  }

  const save = async () => {
    if (!valid) return
    setBusy(true); setError(null)
    let receiptStoragePath = null
    if (file) {
      const up = await uploadReceipt(file)
      if (!up.ok) { setError(`Receipt upload failed: ${up.error}`); setBusy(false); return }
      receiptStoragePath = up.path
    }
    const res = await recordExpense({
      amount: amt,
      category: form.category,
      vendor: form.vendor.trim() || null,
      description: form.description.trim() || null,
      occurredAt: form.date ? new Date(`${form.date}T12:00:00`).toISOString() : undefined,
      notes: form.notes.trim() || null,
      receiptStoragePath,
      ...resolveLink(),
    })
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    onSaved?.(res.record)
  }

  const jobLabel = (j) => j.customer_name || j.deceased_name || j.title || `Job ${String(j.id).slice(0, 8)}`

  return (
    <div className="em-bg" onClick={() => !busy && onClose?.()}>
      <div className="em-modal" onClick={e => e.stopPropagation()}>
        <h3 className="em-title">Add expense</h3>
        {presetLabel && !showPicker && <p className="em-sub">Attaching to {presetLabel}</p>}

        {showPicker && (
          <label className="em-field">Attach to
            <select value={link} onChange={e => setLink(e.target.value)}>
              <option value="overhead">General overhead (no link)</option>
              {opts.cemetery.length > 0 && (
                <optgroup label="Cemetery orders">
                  {opts.cemetery.map(o => <option key={o.id} value={`cemetery:${o.id}`}>{o.order_number || 'draft'} · {o.cemetery_name}</option>)}
                </optgroup>
              )}
              {opts.jobs.length > 0 && (
                <optgroup label="Jobs">
                  {opts.jobs.map(j => <option key={j.id} value={`job:${j.id}`}>{jobLabel(j)}</option>)}
                </optgroup>
              )}
              {opts.orders.length > 0 && (
                <optgroup label="Family orders">
                  {opts.orders.map(o => <option key={o.id} value={`order:${o.id}`}>{customerName(o)}</option>)}
                </optgroup>
              )}
            </select>
          </label>
        )}

        <div className="em-row">
          <label className="em-field">Amount
            <input type="number" step="0.01" min="0" value={form.amount} autoFocus onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </label>
          <label className="em-field">Category
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {EXPENSE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <div className="em-row">
          <label className="em-field">Vendor (optional)
            <input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
          </label>
          <label className="em-field">Date
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </label>
        </div>
        <label className="em-field">Description (optional)
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </label>
        <label className="em-field">Notes (optional)
          <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </label>
        {/* FIELD-CAPTURE SEAM (Q6 — future "Field" sprint plugs in here, no
            backend rework needed; uploadReceipt → receipts bucket already works):
            • Camera capture: add `capture="environment"` to this input (mobile
              opens the rear camera directly) and a "Take photo" affordance.
            • GPS tagging: on file select, read navigator.geolocation and pass
              coords into recordExpense via dimension_tags (jsonb, already on
              financial_records) — e.g. { gps: { lat, lng } }.
            • Voice notes: a record button writing a transcript into `notes`,
              or an audio blob to a future `expense_attachments` bucket.
            • Truck/gas auto-logging: a "log fuel" quick-action presetting
              category='vehicle' + GPS; same recordExpense path. */}
        <label className="em-field">Receipt (optional)
          <input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} />
        </label>

        {error && <div className="em-error">{error}</div>}
        <div className="em-actions">
          <button className="em-btn" disabled={busy} onClick={() => onClose?.()}>Cancel</button>
          <button className="em-btn em-btn-primary" disabled={busy || !valid} onClick={save}>{busy ? 'Saving…' : 'Add expense'}</button>
        </div>
      </div>
    </div>
  )
}

const styles = `
  .em-bg{ position:fixed; inset:0; background:rgba(15,20,25,.42); z-index:1100; display:flex; align-items:center; justify-content:center; padding:24px; }
  .em-modal{ background:var(--sb-surface); border-radius:10px; max-width:460px; width:100%; padding:24px 26px; box-shadow:0 16px 48px rgba(15,20,25,.24); max-height:92vh; overflow-y:auto; }
  .em-title{ font-size:18px; font-weight:600; margin:0 0 4px; }
  .em-sub{ font-size:12.5px; color:var(--sb-text-muted); margin:0 0 14px; }
  .em-row{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .em-field{ display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--sb-text-muted); margin-bottom:12px; }
  .em-field input, .em-field select, .em-field textarea{ font:inherit; font-size:13px; padding:8px 10px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-bg); color:var(--sb-text); }
  .em-error{ font-size:12.5px; color:#b54040; background:#fbe5e5; border-radius:6px; padding:8px 12px; margin-bottom:12px; }
  .em-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
  .em-btn{ border:.5px solid var(--sb-border); background:var(--sb-surface); color:var(--sb-text); border-radius:6px; padding:8px 16px; font:inherit; font-size:13px; cursor:pointer; }
  .em-btn:hover{ background:var(--sb-surface-muted); }
  .em-btn:disabled{ opacity:.5; cursor:not-allowed; }
  .em-btn-primary{ background:var(--sb-text); color:var(--sb-bg); border-color:transparent; }
  .em-btn-primary:hover{ opacity:.88; }
`
if (typeof document !== 'undefined' && !document.getElementById('em-styles')) {
  const tag = document.createElement('style'); tag.id = 'em-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
