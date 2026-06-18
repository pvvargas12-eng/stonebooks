// =============================================================================
// StonePREditor — edit a PR's line items (Stone / Photo / Etching, by `kind`):
// add / remove / change quantity / override the Item wording. Wording overrides
// persist to bulk_order_items.spec_text (print shows the override when set, else
// the resolved/composed spec). A pull-from-needs panel adds new lines.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { getBulkOrderWithItems, addBulkOrderItem, updateBulkOrderItem, deleteBulkOrderItem } from '../lib/stonebooksData'
import { resolveSpecsForPR, loadPRNeeds, prLineFromNeed, prKind } from '../lib/prKinds'
import { isBaseSpec } from '../lib/prSpec'

let _tmp = 0
const tmpId = () => `new-${++_tmp}`
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Signature used to hide a need that's already a line (per kind).
function rowSig(kind, r) {
  if (!r.order_id) return null
  if (kind === 'photo') return `${r.order_id}|${norm(r.size)}|${norm(r.top)}`
  if (kind === 'etching') return `${r.order_id}|${norm(r.size)}`
  return `${r.order_id}:${isBaseSpec(r.spec_text || r.live) ? 'base' : 'stone'}`
}
function needSig(kind, n) {
  if (kind === 'photo') return `${n.orderId}|${norm(n.size)}|${norm(n.type)}`
  if (kind === 'etching') return `${n.orderId}|${norm(n.size)}`
  return `${n.orderId}:${n.kind === 'base' ? 'base' : 'stone'}`
}

export default function StonePREditor({ bulkOrderId, onClose, onSaved, kind = 'stone' }) {
  const K = prKind(kind)
  const [rows, setRows] = useState([])
  const [orig, setOrig] = useState({})
  const [poNumber, setPoNumber] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [needs, setNeeds] = useState([])
  const [showNeeds, setShowNeeds] = useState(false)

  const load = useCallback(async () => {
    const r = await getBulkOrderWithItems(bulkOrderId)
    if (!r.ok) { setLoadErr(r.error); setLoading(false); return }
    setPoNumber(r.order?.po_number || '')
    const items = r.items || []
    const { liveSpec } = await resolveSpecsForPR(kind, items)
    const mapped = items.map(it => {
      const live = liveSpec[it.id] || '—'
      return {
        id: it.id, family_name: it.family_name || '', quantity: it.quantity ?? 1,
        spec_text: it.spec_text || live, live, dbOverride: it.spec_text || '', isNew: false,
        order_id: it.order_id || null, size: it.size || '', top: it.top || '',
      }
    })
    setRows(mapped)
    setOrig(Object.fromEntries(mapped.map(m => [m.id, { family_name: m.family_name, quantity: m.quantity, spec_text: m.dbOverride }])))
    setLoading(false)
  }, [bulkOrderId, kind])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    let alive = true
    loadPRNeeds(kind).then(ns => { if (alive) setNeeds(ns) }).catch(() => {})
    return () => { alive = false }
  }, [kind])

  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id))
  const addRow = () => setRows(rs => [...rs, { id: tmpId(), family_name: '', quantity: 1, spec_text: '', live: '—', isNew: true, order_id: null, size: '', top: '' }])
  const addNeed = (n) => {
    const lf = prLineFromNeed(kind, n)
    setRows(rs => [...rs, {
      id: tmpId(), family_name: n.family || '', quantity: 1, spec_text: n.spec || '', live: n.spec || '—', isNew: true,
      order_id: n.orderId || null, size: lf.size || '', top: lf.top || '',
      color: lf.color || '', sides: lf.sides || '',
    }])
  }
  const addedSigs = new Set(rows.map(r => rowSig(kind, r)).filter(Boolean))

  const save = async () => {
    if (saving) return
    setSaving(true); setErr(null)
    try {
      const liveIds = new Set(rows.map(r => r.id))
      for (const id of Object.keys(orig)) {
        if (!liveIds.has(id)) { const d = await deleteBulkOrderItem(id); if (!d.ok) throw new Error(d.error) }
      }
      for (const r of rows) {
        const val = (r.spec_text || '').trim()
        const ov = (val === '' || val === (r.live || '').trim()) ? '' : val
        if (r.isNew) {
          if (!r.family_name.trim() && !ov && !r.order_id) continue
          const a = await addBulkOrderItem(bulkOrderId, {
            family_name: r.family_name, quantity: r.quantity, spec_text: ov,
            order_id: r.order_id || null, color: r.color, size: r.size, top: r.top, sides: r.sides,
          }, kind)
          if (!a.ok) throw new Error(a.error)
        } else {
          const o = orig[r.id]
          if (o && (o.family_name !== r.family_name || Number(o.quantity) !== Number(r.quantity) || (o.spec_text || '') !== ov)) {
            const u = await updateBulkOrderItem(r.id, { family_name: r.family_name, quantity: r.quantity, spec_text: ov })
            if (!u.ok) throw new Error(u.error)
          }
        }
      }
      setSaving(false)
      onSaved?.()
    } catch (e) { setSaving(false); setErr(String(e?.message || e)) }
  }

  return (
    <div className="pre-overlay" onClick={onClose}>
      <style>{PRE_CSS}</style>
      <div className="pre-modal" onClick={e => e.stopPropagation()}>
        <div className="pre-head">
          <div><div className="pre-eyebrow">Edit {K.label} request</div><h2 className="pre-title">{poNumber || 'PR'}</h2></div>
          <button type="button" className="pre-x" onClick={onClose}>×</button>
        </div>

        <div className="pre-body">
          {loading ? <div className="sb-empty">Loading lines…</div>
            : loadErr ? <div className="sb-empty">Couldn’t load the PR.<br /><span className="pre-muted">{loadErr}</span></div>
            : (
              <>
                <div className="pre-hint">Each {K.itemHeader} field is pre-filled with the resolved spec — edit the wording to override it. Clear it to fall back to the auto-resolved spec.</div>
                <table className="pre-table">
                  <thead><tr><th>Family</th><th>{K.itemHeader} wording</th><th className="pre-qty-h">Qty</th><th /></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={4} className="pre-empty">No lines. Add one below.</td></tr>}
                    {rows.map(r => (
                      <tr key={r.id} className={r.isNew ? 'pre-row-new' : ''}>
                        <td><input className="sb-input" value={r.family_name} onChange={e => setRow(r.id, { family_name: e.target.value })} placeholder="Family" /></td>
                        <td><input className="sb-input pre-spec" value={r.spec_text} onChange={e => setRow(r.id, { spec_text: e.target.value })} placeholder="Type the item spec…" /></td>
                        <td><input className="sb-input pre-qty" type="number" min="1" value={r.quantity} onChange={e => setRow(r.id, { quantity: e.target.value })} /></td>
                        <td><button type="button" className="pre-rm" title="Remove line" onClick={() => removeRow(r.id)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="pre-add-row">
                  <button type="button" className="pre-add" onClick={addRow}>+ Add blank line</button>
                  {needs.length > 0 && (
                    <button type="button" className="pre-add" onClick={() => setShowNeeds(v => !v)}>
                      {showNeeds ? '▾' : '▸'} Pull from open-order needs ({needs.length})
                    </button>
                  )}
                </div>

                {showNeeds && needs.length > 0 && (
                  <div className="pre-needs">
                    {needs.map(n => {
                      const added = addedSigs.has(needSig(kind, n))
                      return (
                        <div key={n.key} className="pre-need">
                          <span className="pre-need-fam">{n.family}</span>
                          {kind === 'stone' && <span className="pre-need-kind">{n.kind === 'base' ? 'Base' : 'Die'}</span>}
                          {kind === 'photo' && <span className={`pre-need-kind ${n.hasImage ? '' : 'pre-need-warn'}`}>{n.hasImage ? 'photo' : 'no photo'}</span>}
                          <span className="pre-need-spec">{n.spec}</span>
                          <button type="button" className="pre-need-add" disabled={added} onClick={() => addNeed(n)}>{added ? 'Added' : 'Add'}</button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {err && <div className="pre-err">{err}</div>}
              </>
            )}
        </div>

        <div className="pre-foot">
          <button type="button" className="sb-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn-primary" disabled={saving || loading || !!loadErr} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

const PRE_CSS = `
  .pre-overlay { position: fixed; inset: 0; z-index: 1280; background: rgba(20,18,14,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .pre-modal { background: var(--sb-surface, #fff); width: min(820px, 96vw); max-height: 90vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
  .pre-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .pre-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .pre-title { margin: 3px 0 0; font-size: 20px; font-weight: 700; color: var(--sb-text, #2a2a2a); font-family: var(--font-m, monospace); }
  .pre-x { background: none; border: none; font-size: 26px; line-height: 1; color: #9a9389; cursor: pointer; }
  .pre-body { padding: 16px 22px; overflow-y: auto; flex: 1 1 auto; }
  .pre-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); }
  .pre-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .pre-hint { font-size: 12.5px; color: var(--sb-text-muted, #6b6256); margin-bottom: 12px; line-height: 1.5; }

  .pre-table { width: 100%; border-collapse: collapse; }
  .pre-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 4px 8px; }
  .pre-qty-h { width: 70px; }
  .pre-table td { padding: 4px 8px; vertical-align: middle; }
  .pre-table .sb-input { font-size: 13px; width: 100%; }
  .pre-spec { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; }
  .pre-qty { text-align: center; }
  .pre-row-new .sb-input { background: #fbf7ec; }
  .pre-empty { text-align: center; color: #999; padding: 18px; }
  .pre-rm { background: none; border: none; color: #b3261e; font-size: 18px; cursor: pointer; line-height: 1; }
  .pre-add-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .pre-add { background: none; border: 1px dashed var(--sb-border, #d8d2c4); border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; color: #6b5d3a; padding: 8px 14px; cursor: pointer; }
  .pre-add:hover { background: var(--sb-surface-muted, #faf8f3); }
  .pre-needs { margin-top: 10px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 8px; max-height: 240px; overflow-y: auto; }
  .pre-need { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .pre-need:last-child { border-bottom: 0; }
  .pre-need-fam { font-weight: 700; font-size: 13px; min-width: 120px; }
  .pre-need-kind { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b5d3a; background: #f4efe4; border-radius: 4px; padding: 1px 6px; }
  .pre-need-warn { color: #b3261e; background: #fae3e0; }
  .pre-need-spec { flex: 1; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #6b6256; }
  .pre-need-add { font: inherit; font-size: 12px; font-weight: 600; padding: 3px 12px; border-radius: 6px; border: 1px solid #1f7a3d; background: #1f7a3d; color: #fff; cursor: pointer; }
  .pre-need-add:disabled { background: #e7f3ea; color: #1f7a3d; cursor: default; }
  .pre-err { color: #b3261e; font-size: 13px; margin-top: 10px; }
`
