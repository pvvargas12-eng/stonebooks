// =============================================================================
// CheckJobModal — "somebody drive out and look at it" (Paul 2026-07-15)
// =============================================================================
// A check job is the site inspection BEFORE a repair estimate: the family asks
// for a repair, we have to go see the stone first. It is a first-class task
// (shop_tasks, task_type='check_job') so it lands in the Task Command Center,
// the Jobs → Check jobs tab, and the assignee's list — nothing falls through.
//
// Fields per Paul: person to task · cemetery · notes · photo drop (photos on a
// lead/order-linked check job also land in that order's attachment list).
// Opened from: a lead's ⋯ menu, the New Lead modal ("Save + check job"), and
// the order's quick actions.
// =============================================================================

import { useState, useEffect, useRef } from 'react'
import { searchCemeteries, rowToCemetery } from '../SalesMode'
import { addShopTask, uploadTaskAttachment, getCurrentStaffName, STAFF_NAMES } from '../lib/stonebooksData'
import { DEPARTMENTS } from '../lib/employees'

const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

// order (optional): { id, label, cemeteryId, cemeteryName } — links the check
// job to the lead/order and prefills the cemetery.
export default function CheckJobModal({ order = null, onClose, onSaved }) {
  const [assignee, setAssignee] = useState('')
  const [cemetery, setCemetery] = useState(order?.cemeteryName || '')
  const [cemeteryId, setCemeteryId] = useState(order?.cemeteryId || null)
  const [cemResults, setCemResults] = useState([])
  const [cemOpen, setCemOpen] = useState(false)
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([])   // [{name,url,path}]
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const cemTimer = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { setDue(todayISO()) }, [])

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

  const onFilesChosen = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true); setErr(null)
    for (const file of files) {
      const r = await uploadTaskAttachment({ orderId: order?.id || null }, file)
      if (!r.ok) { setErr(r.error); break }
      setPhotos(p => [...p, { name: r.name, url: r.url, path: r.path }])
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    setErr(null)
    if (!assignee) { setErr('Pick who goes out to check it.'); return }
    const cemName = cemetery.trim()
    setBusy(true)
    const actor = await getCurrentStaffName().catch(() => null)
    const title = `Check job — ${cemName || 'site inspection'}${order?.label ? ` · ${order.label}` : ''}`
    const r = await addShopTask({
      title,
      assignee,
      assigneeKind: DEPARTMENTS.includes(assignee) ? 'department' : 'person',
      orderId: order?.id || null,
      dueDate: due || null,
      createdBy: actor, taskedBy: actor,
      taskType: 'check_job',
      attachments: photos,
      details: { cemeteryId: cemeteryId || null, cemeteryName: cemName || null, notes: notes.trim() || null },
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onSaved?.(r.task)
  }

  return (
    <div className="cj-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <style>{CSS}</style>
      <div className="cj-modal" role="dialog" aria-modal="true">
        <div className="cj-head">
          <h2 className="cj-title">Add check job</h2>
          <p className="cj-sub">
            Someone drives out and inspects before we quote the repair.
            {order?.label ? <> Linked to <strong>{order.label}</strong>.</> : null}
          </p>
        </div>

        <div className="cj-body">
          <div className="cj-grid2">
            <label className="cj-field">
              <span className="cj-label">Who checks it <em className="cj-req">*</em></span>
              <select className="cj-input cj-select" value={assignee} onChange={e => setAssignee(e.target.value)} autoFocus>
                <option value="">Pick a person…</option>
                <optgroup label="People">
                  {STAFF_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
                <optgroup label="Departments">
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="cj-field">
              <span className="cj-label">Due</span>
              <input className="cj-input" type="date" value={due} onChange={e => setDue(e.target.value)} />
            </label>
          </div>

          <div className="cj-field cj-ac">
            <span className="cj-label">Cemetery</span>
            <input className="cj-input" type="text" value={cemetery}
              placeholder="Search or type a cemetery…"
              onChange={e => onCemType(e.target.value)}
              onFocus={() => { if (cemResults.length) setCemOpen(true) }}
              onBlur={() => setTimeout(() => setCemOpen(false), 150)} />
            {cemOpen && cemResults.length > 0 && (
              <div className="cj-ac-menu">
                {cemResults.map(r => (
                  <button type="button" key={r.id} className="cj-ac-item" onMouseDown={() => pickCem(r)}>
                    <strong>{r.name}</strong>{r.city ? <span className="cj-ac-meta"> · {r.city}{r.state ? `, ${r.state}` : ''}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="cj-field">
            <span className="cj-label">Notes</span>
            <textarea className="cj-input cj-textarea" rows={3} value={notes}
              placeholder="What the family says is wrong — cracked base, leaning stone, section/grave if known…"
              onChange={e => setNotes(e.target.value)} />
          </label>

          <div className="cj-field">
            <span className="cj-label">Photos (if the family sent any)</span>
            <div className="cj-drop">
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFilesChosen} />
              <button type="button" className="cj-dropbtn" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : '+ Add photos'}
              </button>
              {photos.map((p, i) => (
                <span key={p.path || i} className="cj-fchip">{p.name}
                  <button type="button" onClick={() => setPhotos(list => list.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              {order?.id && photos.length > 0 && <span className="cj-hint">Photos also land in the order's attachments.</span>}
            </div>
          </div>
        </div>

        {err && <div className="cj-err">{err}</div>}

        <div className="cj-actions">
          <button type="button" className="cj-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cj-btn cj-btn-primary" onClick={save} disabled={busy || !assignee}>
            {busy ? 'Saving…' : 'Add check job'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CSS = `
.cj-overlay { position: fixed; inset: 0; z-index: 1150; background: rgba(15,20,25,0.45); display: flex; align-items: flex-start; justify-content: center; padding: 60px 20px 20px; overflow: auto; }
.cj-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
.cj-head { padding: 18px 22px 11px; border-bottom: 1px solid #f0ece1; }
.cj-title { font-size: 18px; font-weight: 700; color: #0f1419; margin: 0; }
.cj-sub { font-size: 13px; color: #8a8472; margin: 4px 0 0; }
.cj-body { padding: 15px 22px; display: flex; flex-direction: column; gap: 12px; }
.cj-grid2 { display: grid; grid-template-columns: 1fr 150px; gap: 12px; }
.cj-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.cj-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8472; }
.cj-req { color: #b3261e; font-style: normal; }
.cj-input { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid #d8d2c4; border-radius: 8px; background: #fff; color: #1a1a1a; width: 100%; box-sizing: border-box; }
.cj-input:focus { outline: none; border-color: #9A7209; box-shadow: 0 0 0 2px rgba(154,114,9,0.12); }
.cj-select { -webkit-appearance: menulist; appearance: auto; cursor: pointer; }
.cj-textarea { resize: vertical; line-height: 1.45; }
.cj-ac { position: relative; }
.cj-ac-menu { position: absolute; left: 0; right: 0; top: 100%; z-index: 20; margin-top: 4px; background: #fff; border: 1px solid #e0dccf; border-radius: 9px; box-shadow: 0 12px 30px rgba(0,0,0,0.16); max-height: 220px; overflow: auto; }
.cj-ac-item { display: block; width: 100%; text-align: left; background: none; border: none; font: inherit; font-size: 13.5px; padding: 8px 11px; cursor: pointer; color: #2a2a2a; }
.cj-ac-item:hover { background: #f4f2ec; }
.cj-ac-meta { color: #8a8472; }
.cj-drop { border: 1.5px dashed #d8d2c4; border-radius: 10px; padding: 11px 13px; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; background: #fdfcf9; }
.cj-dropbtn { font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; background: #fff; border: 1px solid #9A7209; border-radius: 8px; padding: 7px 13px; cursor: pointer; }
.cj-dropbtn:disabled { opacity: 0.6; cursor: default; }
.cj-fchip { font-size: 12px; background: #f6f3ec; border: 1px solid rgba(26,30,36,0.1); border-radius: 8px; padding: 5px 9px; display: inline-flex; align-items: center; gap: 7px; }
.cj-fchip button { font: 700 12px/1 inherit; font-family: inherit; background: none; border: none; cursor: pointer; color: #b3261e; }
.cj-hint { font-size: 11px; color: #9A7209; }
.cj-err { margin: 0 22px 12px; background: #fbeaea; border: 1px solid #e7b3ad; color: #b3261e; border-radius: 8px; padding: 9px 12px; font-size: 13px; }
.cj-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 13px 22px 18px; border-top: 1px solid #f0ece1; }
.cj-btn { font: inherit; font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 8px; border: 1px solid #d8d2c4; background: #fff; color: #444; cursor: pointer; }
.cj-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
.cj-btn-primary { background: #0f1419; border-color: #0f1419; color: #fff; }
.cj-btn-primary:hover:not(:disabled) { background: #1e2d3d; border-color: #1e2d3d; color: #fff; }
.cj-btn:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 520px) { .cj-grid2 { grid-template-columns: 1fr; } }
`
