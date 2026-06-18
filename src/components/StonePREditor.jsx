// =============================================================================
// StonePREditor — edit a Stone PR's line items: add / remove / change quantity /
// override the Item wording. Wording overrides persist to bulk_order_items.spec_text
// (the print view shows the override when set, else the live-resolved spec).
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import {
  getBulkOrderWithItems, addBulkOrderItem, updateBulkOrderItem, deleteBulkOrderItem,
  getActiveStoneOrders, getInventoryStock,
} from '../lib/stonebooksData'
import { resolvePRLineSpecs, isBaseSpec } from '../lib/prSpec'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'

let _tmp = 0
const tmpId = () => `new-${++_tmp}`

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}
const specFromNeed = (n) => (n.kind === 'base' ? `Base: ${n.spec}${n.color ? ` · ${n.color}` : ''}` : `Die: ${n.spec}`)
// Stable per-need key matching resolveStoneNeeds: "<orderId>:stone" (die) / ":base".
const needKeyForRow = (r) => (r.need_key || (r.order_id ? `${r.order_id}:${r.kind === 'base' ? 'base' : 'stone'}` : null))

export default function StonePREditor({ bulkOrderId, onClose, onSaved }) {
  const [rows, setRows] = useState([])
  const [orig, setOrig] = useState({})        // id → { family_name, quantity, spec_text }
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
    const { liveSpec } = await resolvePRLineSpecs(items)
    const mapped = items.map(it => ({
      id: it.id, family_name: it.family_name || '', quantity: it.quantity ?? 1,
      spec_text: it.spec_text || '', live: liveSpec[it.id] || '—', isNew: false,
      order_id: it.order_id || null, kind: isBaseSpec(liveSpec[it.id]) ? 'base' : 'die',
    }))
    setRows(mapped)
    setOrig(Object.fromEntries(mapped.map(m => [m.id, { family_name: m.family_name, quantity: m.quantity, spec_text: m.spec_text }])))
    setLoading(false)
  }, [bulkOrderId])
  useEffect(() => { load() }, [load])

  // Open-order stone needs with no available yard match (same source as the builder).
  useEffect(() => {
    let alive = true
    Promise.all([getActiveStoneOrders(), getInventoryStock()]).then(([ordRes, stockRes]) => {
      if (!alive) return
      const stock = stockRes.rows || []
      const orders = (ordRes.rows || []).map(row => { const o = rowToOrder(row, null, null); o.family = familyOf(row); return o })
      const matched = matchNeedsToStock(resolveStoneNeeds(orders), stock)
      setNeeds(matched.filter(m => !m.best && !m.fulfilled).map(m => m.need))
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id))
  const addRow = () => setRows(rs => [...rs, { id: tmpId(), family_name: '', quantity: 1, spec_text: '', live: '—', isNew: true, order_id: null, kind: 'die' }])
  const addNeed = (n) => setRows(rs => [...rs, {
    id: tmpId(), family_name: n.family || '', quantity: 1, spec_text: '', live: specFromNeed(n), isNew: true,
    order_id: n.orderId || null, kind: n.kind === 'base' ? 'base' : 'die', need_key: n.key,
    color: n.color || '', size: n.size || '', top: n.top || '', sides: n.sides || '',
  }])
  const addedKeys = new Set(rows.map(needKeyForRow).filter(Boolean))

  const save = async () => {
    if (saving) return
    setSaving(true); setErr(null)
    try {
      const liveIds = new Set(rows.map(r => r.id))
      // deletes: in orig, gone from rows
      for (const id of Object.keys(orig)) {
        if (!liveIds.has(id)) { const d = await deleteBulkOrderItem(id); if (!d.ok) throw new Error(d.error) }
      }
      for (const r of rows) {
        if (r.isNew) {
          if (!r.family_name.trim() && !r.spec_text.trim() && !r.order_id) continue   // skip blank new rows
          const a = await addBulkOrderItem(bulkOrderId, {
            family_name: r.family_name, quantity: r.quantity, spec_text: r.spec_text,
            order_id: r.order_id || null, color: r.color, size: r.size, top: r.top, sides: r.sides,
          })
          if (!a.ok) throw new Error(a.error)
        } else {
          const o = orig[r.id]
          if (o && (o.family_name !== r.family_name || Number(o.quantity) !== Number(r.quantity) || (o.spec_text || '') !== (r.spec_text || ''))) {
            const u = await updateBulkOrderItem(r.id, { family_name: r.family_name, quantity: r.quantity, spec_text: r.spec_text })
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
          <div><div className="pre-eyebrow">Edit purchase request</div><h2 className="pre-title">{poNumber || 'PR'}</h2></div>
          <button type="button" className="pre-x" onClick={onClose}>×</button>
        </div>

        <div className="pre-body">
          {loading ? <div className="sb-empty">Loading lines…</div>
            : loadErr ? <div className="sb-empty">Couldn’t load the PR.<br /><span className="pre-muted">{loadErr}</span></div>
            : (
              <>
                <div className="pre-hint">Edit the wording to override what prints on the Item line. Leave it blank to use the auto-resolved spec (shown as the placeholder).</div>
                <table className="pre-table">
                  <thead><tr><th>Family</th><th>Item wording</th><th className="pre-qty-h">Qty</th><th /></tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={4} className="pre-empty">No lines. Add one below.</td></tr>}
                    {rows.map(r => (
                      <tr key={r.id} className={r.isNew ? 'pre-row-new' : ''}>
                        <td><input className="sb-input" value={r.family_name} onChange={e => setRow(r.id, { family_name: e.target.value })} placeholder="Family" /></td>
                        <td><input className="sb-input pre-spec" value={r.spec_text} onChange={e => setRow(r.id, { spec_text: e.target.value })} placeholder={r.live} /></td>
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
                    {needs.map(n => (
                      <div key={n.key} className="pre-need">
                        <span className="pre-need-fam">{n.family}</span>
                        <span className="pre-need-kind">{n.kind === 'base' ? 'Base' : 'Die'}</span>
                        <span className="pre-need-spec">{n.spec}</span>
                        <button type="button" className="pre-need-add" disabled={addedKeys.has(n.key)} onClick={() => addNeed(n)}>
                          {addedKeys.has(n.key) ? 'Added' : 'Add'}
                        </button>
                      </div>
                    ))}
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
  .pre-need-spec { flex: 1; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12px; color: #6b6256; }
  .pre-need-add { font: inherit; font-size: 12px; font-weight: 600; padding: 3px 12px; border-radius: 6px; border: 1px solid #1f7a3d; background: #1f7a3d; color: #fff; cursor: pointer; }
  .pre-need-add:disabled { background: #e7f3ea; color: #1f7a3d; cursor: default; }
  .pre-err { color: #b3261e; font-size: 13px; margin-top: 10px; }
`
