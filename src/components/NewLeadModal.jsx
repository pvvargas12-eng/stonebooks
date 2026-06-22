// =============================================================================
// NewLeadModal — lightweight first-call lead intake.
// =============================================================================
// A lead is NOT a separate record — it's an order created at the earliest lead
// status ('draft'). Captures name, contact, cemetery, service type, a note, and a
// first-class reminder (a real order_activity task). Persists through the SAME
// create path the full form uses (saveOrder); the rest is filled later.
//
// Cemetery is a searchable picker over the existing library (searchCemeteries);
// picking sets the cemetery id so saveOrder reuses it, and typing a new name
// lookup-or-creates via upsertCemetery (no duplicate-name crash). Notes →
// order_notes (NEVER inscription). Reminder → order_activity task (+ next_follow_up).
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import { makeBlankOrder, saveOrder, searchCemeteries, rowToCemetery, SALES_REPS } from '../SalesMode'
import { phoneDigits, addOrderNote, addOrderTask, updateOrderLeadFields, getCurrentStaffName } from '../lib/stonebooksData'

// Today as YYYY-MM-DD. Call only in event handlers / effects (never in render).
const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

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
  const [cemetery, setCemetery] = useState('')        // typed/selected cemetery name
  const [cemeteryId, setCemeteryId] = useState(null)  // set when an existing one is picked
  const [cemResults, setCemResults] = useState([])
  const [cemOpen, setCemOpen] = useState(false)
  const [serviceType, setServiceType] = useState('')
  const [notes, setNotes] = useState('')
  // Reminder is first-class — a real order_activity task + next_follow_up.
  const [taskLabel, setTaskLabel] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const cemTimer = useRef(null)

  // Due defaults to today (computed off-render to respect React purity).
  useEffect(() => { setTaskDue(todayISO()) }, [])

  const canSave = name.trim().length > 0 && !busy

  // Cemetery typeahead — debounced search over the existing library. Typing a new
  // name clears the picked id so saveOrder lookup-or-creates it.
  const onCemType = (v) => {
    setCemetery(v); setCemeteryId(null)
    if (cemTimer.current) clearTimeout(cemTimer.current)
    if (!v || v.trim().length < 1) { setCemResults([]); setCemOpen(false); return }
    cemTimer.current = setTimeout(() => {
      searchCemeteries(v).then(rows => { setCemResults(rows || []); setCemOpen(true) })
    }, 220)
  }
  const pickCem = (row) => {
    const c = rowToCemetery(row)
    setCemetery(c.name || row.name || ''); setCemeteryId(c.id || row.id || null)
    setCemResults([]); setCemOpen(false)
  }

  const save = async () => {
    if (!canSave) return
    setBusy(true); setErr(null)
    const { firstName, lastName } = splitName(name)
    const blank = makeBlankOrder()
    const cemName = cemetery.trim()
    const leadOrder = {
      ...blank,
      status: 'draft',
      serviceTypes: serviceType ? [serviceType] : [],
      customer: {
        ...blank.customer,
        firstName, lastName,
        phonePrimary: phone ? phoneDigits(phone) : '',
        email: email.trim(),
      },
      // Picked id → saveOrder reuses it; typed name → upsertCemetery lookup-or-creates.
      cemetery: cemName
        ? { ...blank.cemetery, id: cemeteryId || null, name: cemName }
        : blank.cemetery,
      // Inscription stays empty — the note belongs in order NOTES, not on the stone.
    }
    const res = await saveOrder(leadOrder)
    if (!res?.ok) { setBusy(false); setErr(res?.error?.message || res?.reason || 'Could not save the lead'); return }
    const orderId = res.order?.id || null
    if (orderId) {
      const actor = await getCurrentStaffName().catch(() => null)
      if (notes.trim()) await addOrderNote({ orderId, body: notes.trim(), author: actor })
      if (taskLabel.trim()) {
        const due = taskDue || todayISO()
        await addOrderTask(orderId, { note: taskLabel.trim(), dueDate: due, assignee: assignee || null, actor })
        await updateOrderLeadFields(orderId, { next_follow_up: due })
      }
    }
    setBusy(false)
    onSaved?.(orderId)
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
            <div className="nl-field nl-ac">
              <span className="nl-label">Cemetery</span>
              <input className="nl-input" type="text" value={cemetery}
                placeholder="Search or type a cemetery…"
                onChange={e => onCemType(e.target.value)}
                onFocus={() => { if (cemResults.length) setCemOpen(true) }}
                onBlur={() => setTimeout(() => setCemOpen(false), 150)} />
              {cemOpen && cemResults.length > 0 && (
                <div className="nl-ac-menu">
                  {cemResults.map(r => (
                    <button type="button" key={r.id} className="nl-ac-item" onMouseDown={() => pickCem(r)}>
                      <strong>{r.name}</strong>{r.city ? <span className="nl-ac-meta"> · {r.city}{r.state ? `, ${r.state}` : ''}</span> : null}
                    </button>
                  ))}
                </div>
              )}
              {cemetery.trim() && !cemeteryId && <span className="nl-hint">New cemetery — will be created</span>}
            </div>
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
            <textarea className="nl-input nl-textarea" rows={2} value={notes}
              placeholder="What they want, that they want to come in, anything else…"
              onChange={e => setNotes(e.target.value)} />
          </label>

          {/* Reminder — first-class. Becomes a real order_activity task + sets
              next_follow_up so the lead surfaces in the Leads task table. */}
          <div className="nl-task">
            <div className="nl-task-head">Reminder — what to do next</div>
            <label className="nl-field">
              <span className="nl-label">Reminder</span>
              <input className="nl-input" type="text" value={taskLabel}
                placeholder="e.g. Coming in today at noon · Call back · Send quote"
                onChange={e => setTaskLabel(e.target.value)} />
            </label>
            <div className="nl-task-fields">
              <label className="nl-field">
                <span className="nl-label">Due</span>
                <input className="nl-input" type="date" value={taskDue}
                  onChange={e => setTaskDue(e.target.value)} />
              </label>
              <label className="nl-field">
                <span className="nl-label">Assign to</span>
                <select className="nl-input nl-select" value={assignee} onChange={e => setAssignee(e.target.value)}>
                  <option value="">Unassigned</option>
                  {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>
          </div>
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
.nl-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
.nl-head { padding: 18px 22px 11px; border-bottom: 1px solid #f0ece1; }
.nl-title { font-size: 18px; font-weight: 700; color: #0f1419; margin: 0; }
.nl-sub { font-size: 13px; color: #8a8472; margin: 4px 0 0; }
.nl-body { padding: 15px 22px; display: flex; flex-direction: column; gap: 12px; }
.nl-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.nl-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.nl-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.nl-req { color: #b3261e; font-style: normal; }
.nl-input { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; width: 100%; box-sizing: border-box; }
.nl-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.12); }
.nl-select { -webkit-appearance: menulist; appearance: auto; cursor: pointer; }
.nl-textarea { resize: vertical; line-height: 1.45; }
.nl-hint { font-size: 11px; color: #9A7209; }
/* Cemetery typeahead */
.nl-ac { position: relative; }
.nl-ac-menu { position: absolute; left: 0; right: 0; top: 100%; z-index: 20; margin-top: 4px; background: #fff; border: 1px solid #e0dccf; border-radius: 9px; box-shadow: 0 12px 30px rgba(0,0,0,0.16); max-height: 220px; overflow: auto; }
.nl-ac-item { display: block; width: 100%; text-align: left; background: none; border: none; font: inherit; font-size: 13.5px; padding: 8px 11px; cursor: pointer; color: #2a2a2a; }
.nl-ac-item:hover { background: #f4f2ec; }
.nl-ac-meta { color: #8a8472; }
.nl-task { border: 1px solid #ece6d8; border-radius: 10px; padding: 11px 13px; background: #faf8f3; display: flex; flex-direction: column; gap: 10px; }
.nl-task-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.nl-task-fields { display: grid; grid-template-columns: 150px 1fr; gap: 11px; }
@media (max-width: 520px) { .nl-task-fields { grid-template-columns: 1fr; } }
.nl-err { margin: 0 22px 12px; background: #fbeaea; border: 1px solid #e7b3ad; color: #b3261e; border-radius: 8px; padding: 9px 12px; font-size: 13px; }
.nl-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 13px 22px 18px; border-top: 1px solid #f0ece1; }
.nl-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #444; cursor: pointer; }
.nl-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
.nl-btn-primary { background: #0f1419; border-color: #0f1419; color: #fff; }
.nl-btn-primary:hover:not(:disabled) { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }
.nl-btn:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 520px) { .nl-grid2 { grid-template-columns: 1fr; } }
`
