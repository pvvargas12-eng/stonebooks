// =============================================================================
// ReceivePRModal — receive a Stone PR (full or partial) and land it into the yard.
// =============================================================================
// Each line: a received-qty input (default = remaining) + a Type for the landed
// stock + a land-as choice (Available, or Allocated to the family when the line was
// ordered for a specific order). Save → receivePR writes received_qty, creates the
// inventory_stock rows, and flips the PR to received when fully received.
// =============================================================================

import { useState, useEffect } from 'react'
import { getBulkOrderWithItems, receivePR, INVENTORY_ITEM_TYPES } from '../lib/stonebooksData'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

export default function ReceivePRModal({ bulkOrderId, onClose, onReceived }) {
  const [loading, setLoading] = useState(true)
  const [order, setOrder] = useState(null)
  const [lines, setLines] = useState([])
  const [location, setLocation] = useState('Receiving')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    getBulkOrderWithItems(bulkOrderId).then(r => {
      if (!alive) return
      if (!r.ok) { setErr(r.error); setLoading(false); return }
      setOrder(r.order)
      setLines((r.items || []).map(it => {
        const remaining = Math.max(0, (Number(it.quantity) || 1) - (Number(it.received_qty) || 0))
        return {
          itemId: it.id, quantity: Number(it.quantity) || 1, alreadyReceived: Number(it.received_qty) || 0, remaining,
          color: it.color, size: it.size, top: it.top, sides: it.sides,
          family: it.family_name, orderId: it.order_id,
          item_type: 'custom',
          receivedQty: remaining,
          landAs: it.order_id ? 'allocated' : 'available',
        }
      }))
      setLoading(false)
    }).catch(e => { if (alive) { setErr(String(e?.message || e)); setLoading(false) } })
    return () => { alive = false }
  }, [bulkOrderId])

  const setLine = (i, patch) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  const totalToReceive = lines.reduce((s, l) => s + (Number(l.receivedQty) || 0), 0)

  const save = async () => {
    if (saving) return
    if (totalToReceive <= 0) { setErr('Set a received quantity on at least one line.'); return }
    setSaving(true); setErr(null)
    const r = await receivePR({ bulkOrderId, lines: lines.map(l => ({ ...l, location })) })
    setSaving(false)
    if (!r.ok) { setErr(r.error); return }
    onReceived?.(r)
  }

  return (
    <div className="rpm-overlay" onClick={onClose}>
      <style>{RPM_CSS}</style>
      <div className="rpm-modal" onClick={e => e.stopPropagation()}>
        <div className="rpm-head">
          <div>
            <div className="rpm-eyebrow">Receiving · Stone PR</div>
            <h2 className="rpm-title">{order?.po_number || 'Receive PR'}{order?.supplier_name ? ` · ${order.supplier_name}` : ''}</h2>
          </div>
          <button type="button" className="rpm-x" onClick={onClose}>×</button>
        </div>

        <div className="rpm-body">
          {loading ? (
            <div className="rpm-center">Loading line items…</div>
          ) : (
            <>
              <div className="rpm-loc">
                <label className="rpm-field">
                  <span>Land into location</span>
                  <input className="sb-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="Receiving" />
                </label>
                <span className="rpm-loc-hint">Where the received stone goes in the yard — edit per piece later if needed.</span>
              </div>

              {lines.length === 0 ? (
                <div className="rpm-center">This PR has no line items.</div>
              ) : (
                <table className="rpm-table">
                  <thead>
                    <tr><th>Family</th><th>Color</th><th>Size</th><th>Specs</th><th className="rpm-num">Ordered</th><th className="rpm-num">Recv qty</th><th>Land as</th><th>Type</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.itemId || i}>
                        <td>{l.family || '—'}</td>
                        <td>{l.color || '—'}</td>
                        <td className="rpm-mono">{l.size || '—'}</td>
                        <td>{[l.top, l.sides].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="rpm-num">{l.quantity}{l.alreadyReceived > 0 ? ` (${l.alreadyReceived} in)` : ''}</td>
                        <td className="rpm-num">
                          <input className="sb-input rpm-qty" type="number" min="0" max={l.remaining} value={l.receivedQty}
                            onChange={e => setLine(i, { receivedQty: Math.max(0, Math.min(l.remaining, Number(e.target.value) || 0)) })} />
                        </td>
                        <td>
                          {l.orderId ? (
                            <select className="sb-input rpm-sel" value={l.landAs} onChange={e => setLine(i, { landAs: e.target.value })}>
                              <option value="allocated">Allocated · {l.family || 'family'}</option>
                              <option value="available">Available</option>
                            </select>
                          ) : <span className="rpm-avail">Available</span>}
                        </td>
                        <td>
                          <select className="sb-input rpm-sel" value={l.item_type} onChange={e => setLine(i, { item_type: e.target.value })}>
                            {INVENTORY_ITEM_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {err && <div className="rpm-err">{err}</div>}
            </>
          )}
        </div>

        <div className="rpm-foot">
          <button type="button" className="sb-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="sb-btn-primary" disabled={saving || totalToReceive <= 0} onClick={save}>
            {saving ? 'Receiving…' : `Receive ${totalToReceive} piece${totalToReceive === 1 ? '' : 's'} → yard`}
          </button>
        </div>
      </div>
    </div>
  )
}

const RPM_CSS = `
  .rpm-overlay { position: fixed; inset: 0; z-index: 1280; background: rgba(20,18,14,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
  .rpm-modal { background: var(--sb-surface, #fff); width: min(920px, 96vw); max-height: 92vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.3); }
  .rpm-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .rpm-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .rpm-title { margin: 3px 0 0; font-size: 19px; font-weight: 600; font-family: var(--font-d, 'Playfair Display'), Georgia, serif; color: var(--sb-text, #2a2a2a); }
  .rpm-x { background: none; border: none; font-size: 26px; line-height: 1; color: #9a9389; cursor: pointer; }
  .rpm-body { padding: 16px 22px; overflow-y: auto; flex: 1 1 auto; }
  .rpm-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface-muted, #faf8f3); }
  .rpm-center { padding: 40px; text-align: center; color: var(--sb-text-muted, #8a7f6c); }

  .rpm-loc { margin-bottom: 16px; }
  .rpm-field { display: flex; flex-direction: column; gap: 5px; max-width: 320px; }
  .rpm-field > span { font-size: 11.5px; font-weight: 600; color: var(--sb-text-muted, #8a7f6c); }
  .rpm-loc-hint { font-size: 11.5px; color: var(--sb-text-muted, #a59a86); margin-top: 4px; display: block; }

  .rpm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .rpm-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text-muted, #8a7f6c); padding: 7px 8px; border-bottom: 1px solid var(--sb-border, #e4e0d4); }
  .rpm-table td { padding: 7px 8px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); }
  .rpm-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; }
  .rpm-num { text-align: center; }
  .rpm-qty { width: 64px; text-align: center; padding: 6px; }
  .rpm-sel { padding: 6px 8px; font-size: 12px; }
  .rpm-avail { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }
  .rpm-err { color: #b3261e; font-size: 13px; margin-top: 10px; }
`
