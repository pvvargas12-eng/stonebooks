// =============================================================================
// StonePRBuilder — guided flow to build a purchase request (Stone / Photo /
// Etching, by the `kind` prop). Pick/create a supplier of that kind → add line
// items (manually OR pulled from open-order needs) → PR fields → Save.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { listSuppliers, createSupplier, createPR, getCurrentStaffName, SUPPLIER_KINDS } from '../lib/stonebooksData'
import { loadPRNeeds, prLineFromNeed, prKind } from '../lib/prKinds'

const BLANK_LINE = { family_name: '', color: '', size: '', top: '', sides: '', quantity: 1, notes: '', order_id: null, spec_text: null, need_key: null }

export default function StonePRBuilder({ onClose, onSaved, prefillLines = null, kind = 'stone' }) {
  const K = prKind(kind)
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [showNewSup, setShowNewSup] = useState(false)
  const [newSup, setNewSup] = useState({ name: '', contact_name: '', phone: '', email: '', terms: '', lead_time_days: '', kinds: [K.supplierKind], notes: '' })
  const [supBusy, setSupBusy] = useState(false)

  const [lines, setLines] = useState(() => Array.isArray(prefillLines) ? prefillLines.map(l => ({ ...BLANK_LINE, ...l })) : [])
  const [draft, setDraft] = useState(BLANK_LINE)
  const [needs, setNeeds] = useState([])
  const [showNeeds, setShowNeeds] = useState(false)

  const [placedAt, setPlacedAt] = useState('')
  const [requestedDelivery, setRequestedDelivery] = useState('')
  const [prNotes, setPrNotes] = useState('')
  const [createdBy, setCreatedBy] = useState('')

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const loadSuppliers = useCallback(async () => {
    const r = await listSuppliers()
    setSuppliers(r.rows || [])
  }, [])

  useEffect(() => {
    let alive = true
    const d = new Date(); const p = (n) => String(n).padStart(2, '0')
    setPlacedAt(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    loadSuppliers()
    getCurrentStaffName().then(n => { if (alive && n) setCreatedBy(n) }).catch(() => {})
    loadPRNeeds(kind).then(ns => { if (alive) setNeeds(ns) }).catch(() => {})
    return () => { alive = false }
  }, [loadSuppliers, kind])

  // Suppliers for this PR kind (or kind-less suppliers, shown everywhere).
  const kindSuppliers = suppliers.filter(s => !Array.isArray(s.kinds) || s.kinds.length === 0 || s.kinds.includes(K.supplierKind))
  const supplier = suppliers.find(s => s.id === supplierId) || null
  const isStone = kind === 'stone'

  const saveNewSupplier = async () => {
    if (!newSup.name.trim()) { setErr('Supplier name is required.'); return }
    setSupBusy(true); setErr(null)
    const r = await createSupplier(newSup)
    setSupBusy(false)
    if (!r.ok) { setErr(r.error); return }
    await loadSuppliers()
    setSupplierId(r.row.id)
    setShowNewSup(false)
    setNewSup({ name: '', contact_name: '', phone: '', email: '', terms: '', lead_time_days: '', kinds: [K.supplierKind], notes: '' })
  }

  const addDraft = () => {
    const hasContent = draft.family_name.trim() || draft.size.trim() || (draft.spec_text || '').trim() || draft.color.trim()
    if (!hasContent) return
    setLines(ls => [...ls, { ...draft, quantity: Math.max(1, Number(draft.quantity) || 1) }])
    setDraft(BLANK_LINE)
  }
  const addNeed = (n) => setLines(ls => [...ls, { ...BLANK_LINE, ...prLineFromNeed(kind, n) }])
  const removeLine = (i) => setLines(ls => ls.filter((_, idx) => idx !== i))

  const save = async () => {
    if (saving) return
    if (!supplier) { setErr('Pick or create a supplier.'); return }
    if (lines.length === 0) { setErr('Add at least one line item.'); return }
    setSaving(true); setErr(null)
    const r = await createPR({
      kind, supplier: { id: supplier.id, name: supplier.name },
      placedAt: placedAt || null, requestedDelivery: requestedDelivery || null,
      notes: prNotes || null, createdBy: createdBy || null, lines,
    })
    setSaving(false)
    if (!r.ok) { setErr(r.error); return }
    onSaved?.(r.bulkOrderId)
  }

  const setD = (patch) => setDraft(d => ({ ...d, ...patch }))
  const addedKeys = new Set(lines.map(l => l.need_key).filter(Boolean))
  const lineSpecOf = (l) => (l.spec_text || '').trim()
    || (isStone ? [l.color, l.size, l.top, l.sides].filter(Boolean).join(' · ')
      : kind === 'photo' ? [l.top, l.size].filter(Boolean).join(' · ')
      : (l.size || ''))
    || '—'

  return (
    <div className="prb-overlay" onClick={onClose}>
      <style>{PRB_CSS}</style>
      <div className="prb-modal" onClick={e => e.stopPropagation()}>
        <div className="prb-head">
          <div><div className="prb-eyebrow">Procurement · {K.label}</div><h2 className="prb-title">Build a {K.noun} Purchase Request</h2></div>
          <button type="button" className="prb-x" onClick={onClose}>×</button>
        </div>

        <div className="prb-body">
          {/* SUPPLIER */}
          <section className="prb-sec">
            <div className="prb-sec-title">1 · {K.noun} supplier</div>
            <div className="prb-sup-row">
              <select className="sb-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— pick a supplier —</option>
                {kindSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.lead_time_days ? ` (${s.lead_time_days}d lead)` : ''}</option>)}
              </select>
              <button type="button" className="sb-btn-secondary" onClick={() => setShowNewSup(v => !v)}>{showNewSup ? 'Cancel' : '+ New supplier'}</button>
            </div>
            {showNewSup && (
              <div className="prb-newsup">
                <div className="prb-grid">
                  <Field label="Name *"><input className="sb-input" value={newSup.name} onChange={e => setNewSup(s => ({ ...s, name: e.target.value }))} /></Field>
                  <Field label="Contact"><input className="sb-input" value={newSup.contact_name} onChange={e => setNewSup(s => ({ ...s, contact_name: e.target.value }))} /></Field>
                  <Field label="Phone"><input className="sb-input" value={newSup.phone} onChange={e => setNewSup(s => ({ ...s, phone: e.target.value }))} /></Field>
                  <Field label="Email"><input className="sb-input" value={newSup.email} onChange={e => setNewSup(s => ({ ...s, email: e.target.value }))} /></Field>
                  <Field label="Terms"><input className="sb-input" value={newSup.terms} onChange={e => setNewSup(s => ({ ...s, terms: e.target.value }))} placeholder="Net 30" /></Field>
                  <Field label="Lead time (days)"><input className="sb-input" type="number" value={newSup.lead_time_days} onChange={e => setNewSup(s => ({ ...s, lead_time_days: e.target.value }))} /></Field>
                </div>
                <div className="prb-kinds">
                  <span className="prb-kinds-l">Supplies:</span>
                  {SUPPLIER_KINDS.map(k => (
                    <label key={k} className="prb-kind"><input type="checkbox" checked={newSup.kinds.includes(k)} onChange={e => setNewSup(s => ({ ...s, kinds: e.target.checked ? [...s.kinds, k] : s.kinds.filter(x => x !== k) }))} /> {k}</label>
                  ))}
                </div>
                <button type="button" className="sb-btn-primary" disabled={supBusy} onClick={saveNewSupplier}>{supBusy ? 'Saving…' : 'Save supplier'}</button>
              </div>
            )}
          </section>

          {/* LINES */}
          <section className="prb-sec">
            <div className="prb-sec-title">2 · Line items <span className="prb-sec-count">{lines.length}</span></div>

            {/* manual add — kind-aware */}
            {isStone ? (
              <div className="prb-addline">
                <input className="sb-input prb-i-fam" value={draft.family_name} onChange={e => setD({ family_name: e.target.value })} placeholder="Family" />
                <input className="sb-input" value={draft.color} onChange={e => setD({ color: e.target.value })} placeholder="Color" />
                <input className="sb-input" value={draft.size} onChange={e => setD({ size: e.target.value })} placeholder="Size" />
                <input className="sb-input" value={draft.top} onChange={e => setD({ top: e.target.value })} placeholder="Top" />
                <input className="sb-input" value={draft.sides} onChange={e => setD({ sides: e.target.value })} placeholder="Sides" />
                <input className="sb-input prb-i-qty" type="number" min="1" value={draft.quantity} onChange={e => setD({ quantity: e.target.value })} />
                <input className="sb-input" value={draft.notes} onChange={e => setD({ notes: e.target.value })} placeholder="Notes" />
                <button type="button" className="sb-btn-secondary" onClick={addDraft}>Add</button>
              </div>
            ) : (
              <div className="prb-addline prb-addline-pe">
                <input className="sb-input prb-i-fam" value={draft.family_name} onChange={e => setD({ family_name: e.target.value })} placeholder="Family" />
                <input className="sb-input" value={draft.spec_text || ''} onChange={e => setD({ spec_text: e.target.value })} placeholder={kind === 'photo' ? 'Photo (e.g. Porcelain · 3×4)' : 'Etching (e.g. 8×10)'} />
                <input className="sb-input prb-i-qty" type="number" min="1" value={draft.quantity} onChange={e => setD({ quantity: e.target.value })} />
                <input className="sb-input" value={draft.notes} onChange={e => setD({ notes: e.target.value })} placeholder="Notes" />
                <button type="button" className="sb-btn-secondary" onClick={addDraft}>Add</button>
              </div>
            )}

            {/* from needs */}
            {needs.length > 0 && (
              <div className="prb-needs">
                <button type="button" className="prb-needs-toggle" onClick={() => setShowNeeds(v => !v)}>
                  {showNeeds ? '▾' : '▸'} Pull from open-order needs ({needs.length})
                </button>
                {showNeeds && (
                  <div className="prb-needs-list">
                    {needs.map(n => (
                      <div key={n.key} className="prb-need">
                        <span className="prb-need-fam">{n.family}</span>
                        {isStone && <span className="prb-need-kind">{n.kind === 'base' ? 'Base' : 'Die'}</span>}
                        {kind === 'photo' && <span className={`prb-need-kind ${n.hasImage ? '' : 'prb-need-warn'}`}>{n.hasImage ? 'photo' : 'no photo'}</span>}
                        <span className="prb-need-spec">{n.spec}</span>
                        <button type="button" className="prb-need-add" disabled={addedKeys.has(n.key)} onClick={() => addNeed(n)}>
                          {addedKeys.has(n.key) ? 'Added' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* lines table */}
            {lines.length > 0 && (
              <table className="prb-lines">
                <thead><tr><th>Family</th><th>{K.itemHeader}</th><th>Qty</th><th>Notes</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.family_name || '—'}</td>
                      <td className="prb-mono">{lineSpecOf(l)}</td>
                      <td className="prb-num">{l.quantity}</td>
                      <td>{l.notes || ''}</td>
                      <td><button type="button" className="prb-rm" onClick={() => removeLine(i)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* PR FIELDS */}
          <section className="prb-sec">
            <div className="prb-sec-title">3 · Request details</div>
            <div className="prb-grid">
              <Field label="Date"><input className="sb-input" type="date" value={placedAt} onChange={e => setPlacedAt(e.target.value)} /></Field>
              <Field label="Requested delivery"><input className="sb-input" type="date" value={requestedDelivery} onChange={e => setRequestedDelivery(e.target.value)} /></Field>
              <Field label="Created by"><input className="sb-input" value={createdBy} onChange={e => setCreatedBy(e.target.value)} /></Field>
            </div>
            <Field label="Notes"><textarea className="sb-input" rows={2} value={prNotes} onChange={e => setPrNotes(e.target.value)} placeholder="Anything the supplier should know…" /></Field>
          </section>

          {err && <div className="prb-err">{err}</div>}
        </div>

        <div className="prb-foot">
          <button type="button" className="sb-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn-primary" disabled={saving || !supplier || lines.length === 0} onClick={save}>
            {saving ? 'Saving…' : `Save PR · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="prb-field"><span>{label}</span>{children}</label>
}

const PRB_CSS = `
  .prb-overlay { position: fixed; inset: 0; z-index: 1250; background: rgba(20,18,14,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .prb-modal { background: var(--sb-surface, #fff); width: min(960px, 96vw); max-height: 92vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
  .prb-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .prb-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .prb-title { margin: 3px 0 0; font-size: 20px; font-weight: 600; font-family: var(--font-d, 'Playfair Display'), Georgia, serif; color: var(--sb-text, #2a2a2a); }
  .prb-x { background: none; border: none; font-size: 26px; line-height: 1; color: #9a9389; cursor: pointer; }
  .prb-body { padding: 16px 22px; overflow-y: auto; flex: 1 1 auto; }
  .prb-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); }

  .prb-sec { margin-bottom: 22px; }
  .prb-sec-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b5d3a; margin-bottom: 10px; }
  .prb-sec-count { background: #f4efe4; border-radius: 999px; padding: 0 8px; margin-left: 4px; }
  .prb-sup-row { display: flex; gap: 10px; }
  .prb-sup-row .sb-input { flex: 1; }
  .prb-newsup { margin-top: 12px; padding: 14px; background: var(--sb-surface-muted, #faf8f3); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 10px; }
  .prb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 14px; margin-bottom: 10px; }
  .prb-field { display: flex; flex-direction: column; gap: 5px; }
  .prb-field > span { font-size: 11.5px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .prb-kinds { display: flex; gap: 14px; align-items: center; margin-bottom: 10px; font-size: 13px; }
  .prb-kinds-l { font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .prb-kind { display: inline-flex; gap: 4px; align-items: center; text-transform: capitalize; }

  .prb-addline { display: grid; grid-template-columns: 1.3fr 1fr 1fr 0.9fr 0.9fr 60px 1.2fr auto; gap: 7px; margin-bottom: 12px; }
  .prb-addline-pe { grid-template-columns: 1.3fr 2.4fr 60px 1.2fr auto; }
  .prb-i-qty { text-align: center; }
  .prb-addline .sb-input { font-size: 13px; }

  .prb-needs { margin-bottom: 12px; }
  .prb-needs-toggle { background: none; border: none; font: inherit; font-size: 13px; font-weight: 600; color: #9A7209; cursor: pointer; padding: 4px 0; }
  .prb-needs-list { border: 1px solid var(--sb-border, #e4e0d4); border-radius: 8px; max-height: 220px; overflow-y: auto; }
  .prb-need { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .prb-need:last-child { border-bottom: 0; }
  .prb-need-fam { font-weight: 700; font-size: 13px; min-width: 120px; }
  .prb-need-kind { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b5d3a; background: #f4efe4; border-radius: 4px; padding: 1px 6px; }
  .prb-need-warn { color: #b3261e; background: #fae3e0; }
  .prb-need-spec { flex: 1; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #6b6256; }
  .prb-need-add { font: inherit; font-size: 12px; font-weight: 600; padding: 3px 12px; border-radius: 6px; border: 1px solid #1f7a3d; background: #1f7a3d; color: #fff; cursor: pointer; }
  .prb-need-add:disabled { background: #e7f3ea; color: #1f7a3d; cursor: default; }

  .prb-lines { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 8px; overflow: hidden; }
  .prb-lines th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted, #8a7f6c); background: var(--sb-surface-muted, #faf8f3); padding: 6px 10px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .prb-lines td { padding: 6px 10px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .prb-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11.5px; }
  .prb-num { text-align: center; }
  .prb-rm { background: none; border: none; color: #b3261e; font-size: 16px; cursor: pointer; line-height: 1; }
  .prb-err { color: #b3261e; font-size: 13px; margin-top: 8px; }
`
