// =============================================================================
// NewLeadModal — lightweight first-call lead intake.
// =============================================================================
// A lead is NOT a separate record — it's an order created at the earliest lead
// status ('draft'). This captures only what's known on the first call (caller
// name, contact, cemetery, service type, a free-text note) and persists ONE
// order row through the SAME create path the full form uses (saveOrder). The
// rest is filled later at conversion in the full OrderForm. No job, no pricing.
//
// Field homes (see orderToRow): name → customers (linked via customer_id, so the
// lead shows with a name even though primary_lastname/deceased stay unset),
// service type → orders.service_types, note → orders.inscription.customNotes
// (JSONB; also the note field the compact OrderForm surfaces at conversion).
// =============================================================================

import { useState } from 'react'
import { makeBlankOrder, saveOrder } from '../SalesMode'
import { phoneDigits } from '../lib/stonebooksData'

// Service types match orders.service_types codes (same set as the Orders filter).
const SERVICE_TYPE_OPTIONS = [
  { code: 'NEW_STONE',   label: 'New stone' },
  { code: 'INSCRIPTION', label: 'Additional inscription' },
  { code: 'REPAIR',      label: 'Repair' },
  { code: 'ACID_WASH',   label: 'Acid wash / cleaning' },
  { code: 'BRONZE',      label: 'Bronze' },
  { code: 'MAUSOLEUM',   label: 'Mausoleum / crypt' },
]

// Split a single "Name" entry into first/last (last token = last name) so the
// linked customer carries a last name for the Leads list display.
function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  const lastName = parts.pop()
  return { firstName: parts.join(' '), lastName }
}

export default function NewLeadModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [cemetery, setCemetery] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const canSave = name.trim().length > 0 && !busy

  const save = async () => {
    if (!canSave) return
    setBusy(true); setErr(null)
    const { firstName, lastName } = splitName(name)
    const blank = makeBlankOrder()
    const leadOrder = {
      ...blank,
      status: 'draft',                                   // earliest lead status (A)
      serviceTypes: serviceType ? [serviceType] : [],
      customer: {
        ...blank.customer,
        firstName, lastName,
        phonePrimary: phone ? phoneDigits(phone) : '',
        email: email.trim(),
      },
      cemetery: cemetery.trim()
        ? { ...blank.cemetery, name: cemetery.trim() }
        : blank.cemetery,
      inscription: { ...blank.inscription, customNotes: notes.trim() },
    }
    const res = await saveOrder(leadOrder)
    setBusy(false)
    if (!res?.ok) { setErr(res?.error?.message || res?.reason || 'Could not save the lead'); return }
    onSaved?.(res.order?.id || null)
  }

  return (
    <div className="nl-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{CSS}</style>
      <div className="nl-modal" role="dialog" aria-modal="true">
        <div className="nl-head">
          <h2 className="nl-title">New lead</h2>
          <p className="nl-sub">Quick first-call capture. Fill out the rest later when it becomes an order.</p>
        </div>

        <div className="nl-body">
          <label className="nl-field">
            <span className="nl-label">Name <em className="nl-req">*</em></span>
            <input className="nl-input" type="text" value={name} placeholder="Who called…"
              autoFocus onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
          </label>

          <div className="nl-grid2">
            <label className="nl-field">
              <span className="nl-label">Phone</span>
              <input className="nl-input" type="tel" value={phone} placeholder="(555) 123-4567"
                onChange={e => setPhone(e.target.value)} />
            </label>
            <label className="nl-field">
              <span className="nl-label">Email</span>
              <input className="nl-input" type="email" value={email} placeholder="name@email.com"
                onChange={e => setEmail(e.target.value)} />
            </label>
          </div>

          <div className="nl-grid2">
            <label className="nl-field">
              <span className="nl-label">Cemetery</span>
              <input className="nl-input" type="text" value={cemetery} placeholder="Cemetery name…"
                onChange={e => setCemetery(e.target.value)} />
            </label>
            <label className="nl-field">
              <span className="nl-label">Service type</span>
              <select className="nl-input nl-select" value={serviceType} onChange={e => setServiceType(e.target.value)}>
                <option value="">Not sure yet…</option>
                {SERVICE_TYPE_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </label>
          </div>

          <label className="nl-field">
            <span className="nl-label">Notes</span>
            <textarea className="nl-input nl-textarea" rows={3} value={notes}
              placeholder="What they want, that they want to come in, anything else…"
              onChange={e => setNotes(e.target.value)} />
          </label>
        </div>

        {err && <div className="nl-err">{err}</div>}

        <div className="nl-actions">
          <button type="button" className="nl-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="nl-btn nl-btn-primary" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : 'Save lead'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
.nl-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(15,20,25,0.45); display: flex; align-items: flex-start; justify-content: center; padding: 60px 20px 20px; overflow: auto; }
.nl-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); overflow: hidden; }
.nl-head { padding: 20px 22px 12px; border-bottom: 1px solid #f0ece1; }
.nl-title { font-size: 18px; font-weight: 700; color: #0f1419; margin: 0; }
.nl-sub { font-size: 13px; color: #8a8472; margin: 4px 0 0; }
.nl-body { padding: 16px 22px; display: flex; flex-direction: column; gap: 13px; }
.nl-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
.nl-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.nl-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.nl-req { color: #b3261e; font-style: normal; }
.nl-input { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; width: 100%; box-sizing: border-box; }
.nl-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.12); }
.nl-select { -webkit-appearance: menulist; appearance: auto; cursor: pointer; }
.nl-textarea { resize: vertical; line-height: 1.45; }
.nl-err { margin: 0 22px 12px; background: #fbeaea; border: 1px solid #e7b3ad; color: #b3261e; border-radius: 8px; padding: 9px 12px; font-size: 13px; }
.nl-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px 20px; border-top: 1px solid #f0ece1; }
.nl-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #444; cursor: pointer; }
.nl-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
.nl-btn-primary { background: #0f1419; border-color: #0f1419; color: #fff; }
.nl-btn-primary:hover:not(:disabled) { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }
.nl-btn:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 520px) { .nl-grid2 { grid-template-columns: 1fr; } }
`
