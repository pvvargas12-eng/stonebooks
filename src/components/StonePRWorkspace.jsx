// =============================================================================
// StonePRWorkspace — the full-screen Stone PR editor (Paul, 2026-07-23)
// =============================================================================
// Replaces the cramped modals for STONE PRs. Permit-Builder-style split:
//   LEFT  — the PR itself: every line fully visible in his vendor-sheet columns
//           (Family · Color · Type · Size · Specs · Qty) + a per-line STOCK
//           toggle ("ordered to have" — no family, lands as available stock).
//   RIGHT — the order rail: search any order, see its die/base specs and color
//           resolved from the SAME resolver the contract uses, open its files
//           (contracts included), then Insert Die / Insert Base or Link a line —
//           so he's confirming sizes against the signed record while typing.
// Three modes:
//   'new'    — build a PR to send (draft; Submit later marks orders stone-ordered)
//   'record' — document a PR that already happened OUTSIDE Stonebooks: lands as
//              Ordered, NEVER writes to orders (data-layer guards), receivable.
//   'edit'   — full-width editing of an existing PR's header + lines.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  listSuppliers, createSupplier, createPR, getBulkOrderWithItems,
  addBulkOrderItem, updateBulkOrderItem, deleteBulkOrderItem, updatePRHeader,
  getActiveStoneOrders, listOrderAttachments, getCurrentStaffName,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds } from '../lib/inventoryMatch'

const TYPE_SUGGESTIONS = ['Die', 'Base', 'Backer', 'Grass', 'Hickey', 'Slant', 'Upright', 'Marker', 'Bench', 'Vase', 'Other']
let _tmp = 0
const tmpId = () => `new-${++_tmp}`
const todayISO = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const famOfRow = (r) => (r.primary_lastname && String(r.primary_lastname).trim()) || r.order_number || 'Order'

const BLANK = { family_name: '', color: '', item_type: '', size: '', specs: '', quantity: 1, is_stock: false, order_id: null, order_number: null, spec_text: '', notes: '' }

export default function StonePRWorkspace({ mode = 'new', bulkOrderId = null, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const isRecord = mode === 'record'

  // ── Header state ──
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [supplierName, setSupplierName] = useState('')   // edit-mode display when id missing
  const [showNewSup, setShowNewSup] = useState(false)
  const [newSupName, setNewSupName] = useState('')
  const [placedAt, setPlacedAt] = useState('')
  const [eta, setEta] = useState('')
  const [notes, setNotes] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [headerOrig, setHeaderOrig] = useState(null)

  // ── Lines ──
  const [rows, setRows] = useState(() => [{ ...BLANK, id: tmpId(), isNew: true }])
  const [orig, setOrig] = useState({})
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // ── Rail ──
  const [orders, setOrders] = useState(null)     // active-order roster (raw rows)
  const [railQ, setRailQ] = useState('')
  const [railSel, setRailSel] = useState(null)   // selected raw order row
  const [railFiles, setRailFiles] = useState(null)

  useEffect(() => {
    let alive = true
    listSuppliers().then(r => { if (alive) setSuppliers(r.rows || []) }).catch(() => {})
    getCurrentStaffName().then(n => { if (alive && n) setCreatedBy(n) }).catch(() => {})
    getActiveStoneOrders().then(r => { if (alive) setOrders(r.rows || []) }).catch(() => { if (alive) setOrders([]) })
    if (!isEdit) setPlacedAt(todayISO())
    return () => { alive = false }
  }, [isEdit])

  // Edit mode: load the PR + its lines into the grid.
  useEffect(() => {
    if (!isEdit || !bulkOrderId) return
    let alive = true
    ;(async () => {
      const r = await getBulkOrderWithItems(bulkOrderId)
      if (!alive) return
      if (!r.ok) { setErr(r.error); setLoading(false); return }
      const o = r.order || {}
      setPoNumber(o.po_number || '')
      setSupplierId(o.supplier_id || '')
      setSupplierName(o.supplier_name || '')
      setPlacedAt(o.placed_at ? String(o.placed_at).slice(0, 10) : '')
      setEta(o.supplier_eta ? String(o.supplier_eta).slice(0, 10) : '')
      setNotes((o.notes || '').replace(/\s*·?\s*Created by .+$/, ''))
      setHeaderOrig({ supplier_id: o.supplier_id || '', supplier_name: o.supplier_name || '', placed_at: o.placed_at ? String(o.placed_at).slice(0, 10) : '', supplier_eta: o.supplier_eta ? String(o.supplier_eta).slice(0, 10) : '', notes: (o.notes || '').replace(/\s*·?\s*Created by .+$/, '') })
      const mapped = (r.items || []).map(it => ({
        id: it.id, isNew: false,
        family_name: it.family_name || '', color: it.color || '',
        item_type: it.item_type || '', size: it.size || '', specs: it.specs || [it.top, it.sides].filter(Boolean).join('; '),
        quantity: it.quantity ?? 1, is_stock: !!it.is_stock,
        order_id: it.order_id || null, order_number: null,
        spec_text: it.spec_text || '', notes: it.notes || '',
      }))
      setRows(mapped.length ? mapped : [{ ...BLANK, id: tmpId(), isNew: true }])
      setOrig(Object.fromEntries(mapped.map(m => [m.id, { ...m }])))
      setLoading(false)
    })().catch(e => { if (alive) { setErr(String(e?.message || e)); setLoading(false) } })
    return () => { alive = false }
  }, [isEdit, bulkOrderId])

  // Order numbers for linked lines (display) once the roster is in.
  const orderNoById = useMemo(() => new Map((orders || []).map(o => [o.id, o.order_number])), [orders])

  const setRow = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setRows(rs => rs.filter(r => r.id !== id))
  const addRow = (patch = {}) => setRows(rs => [...rs, { ...BLANK, id: tmpId(), isNew: true, ...patch }])
  const toggleStock = (r) => setRow(r.id, r.is_stock
    ? { is_stock: false }
    : { is_stock: true, family_name: 'Stock', order_id: null, order_number: null })

  // ── Rail derivations ──
  const railResults = useMemo(() => {
    if (orders == null) return []
    const t = railQ.trim().toLowerCase()
    if (!t) return []
    return orders.filter(o => `${o.primary_lastname || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 12)
  }, [orders, railQ])

  const railOrder = useMemo(() => {
    if (!railSel) return null
    try {
      const o = rowToOrder(railSel, null, null)
      o.family = famOfRow(railSel)
      const needs = resolveStoneNeeds([o])
      return { row: railSel, ord: o, needs }
    } catch { return { row: railSel, ord: null, needs: [] } }
  }, [railSel])

  useEffect(() => {
    if (!railSel) { setRailFiles(null); return }
    let alive = true
    setRailFiles(null)
    listOrderAttachments(railSel.id).then(r => { if (alive) setRailFiles(r?.rows || r || []) }).catch(() => { if (alive) setRailFiles([]) })
    return () => { alive = false }
  }, [railSel])

  const insertNeed = (n) => addRow({
    family_name: n.family || '', order_id: n.orderId || null, order_number: n.orderNumber || null,
    color: n.color || '', item_type: n.kind === 'base' ? 'Base' : (n.itemType ? n.itemType.charAt(0).toUpperCase() + n.itemType.slice(1) : 'Die'),
    size: n.size || '', specs: [n.top, n.sides].filter(Boolean).join('; '),
  })
  const linkRowToRail = (r) => {
    if (!railSel) return
    setRow(r.id, { order_id: railSel.id, order_number: railSel.order_number || null, family_name: r.family_name || famOfRow(railSel), is_stock: false })
  }

  const saveNewSupplier = async () => {
    if (!newSupName.trim()) { setErr('Supplier name is required.'); return }
    const r = await createSupplier({ name: newSupName.trim(), kinds: ['stone'] })
    if (!r.ok) { setErr(r.error); return }
    setSuppliers(s => [...s, r.row])
    setSupplierId(r.row.id)
    setShowNewSup(false); setNewSupName('')
  }

  const realRows = () => rows.filter(r => r.family_name.trim() || r.size.trim() || r.specs.trim() || r.color.trim() || r.order_id)

  const save = async () => {
    if (saving) return
    setErr(null)
    const supplier = suppliers.find(s => s.id === supplierId) || (isEdit && supplierName ? { id: supplierId || null, name: supplierName } : null)
    if (!supplier) { setErr('Pick or create a supplier.'); return }
    const lines = realRows()
    if (!lines.length) { setErr('Add at least one line item.'); return }
    setSaving(true)
    try {
      if (!isEdit) {
        const r = await createPR({
          kind: 'stone', supplier: { id: supplier.id, name: supplier.name },
          placedAt: placedAt || null, requestedDelivery: eta || null,
          notes: notes || null, createdBy: createdBy || null,
          recorded: isRecord, status: isRecord ? 'ordered' : 'draft',
          lines: lines.map(l => ({ ...l, spec_text: l.spec_text || null })),
        })
        if (!r.ok) throw new Error(r.error)
        setSaving(false); onSaved?.(r.bulkOrderId); return
      }
      // Edit: header patch + incremental line ops.
      if (headerOrig) {
        const hp = {}
        if ((supplierId || '') !== headerOrig.supplier_id) { hp.supplier_id = supplierId || null; hp.supplier_name = supplier.name }
        if (placedAt !== headerOrig.placed_at) hp.placed_at = placedAt || null
        if (eta !== headerOrig.supplier_eta) hp.supplier_eta = eta || null
        if (notes !== headerOrig.notes) hp.notes = [notes?.trim() || null, createdBy ? `Created by ${createdBy}` : null].filter(Boolean).join(' · ')
        if (Object.keys(hp).length) { const u = await updatePRHeader(bulkOrderId, hp); if (!u.ok) throw new Error(u.error) }
      }
      const liveIds = new Set(rows.map(r => r.id))
      for (const id of Object.keys(orig)) {
        if (!liveIds.has(id)) { const d = await deleteBulkOrderItem(id); if (!d.ok) throw new Error(d.error) }
      }
      for (const r of rows) {
        if (r.isNew) {
          if (!(r.family_name.trim() || r.size.trim() || r.specs.trim() || r.color.trim() || r.order_id)) continue
          const a = await addBulkOrderItem(bulkOrderId, r, 'stone')
          if (!a.ok) throw new Error(a.error)
        } else {
          const o = orig[r.id]
          if (!o) continue
          const changed = ['family_name', 'color', 'item_type', 'size', 'specs', 'is_stock', 'order_id'].some(k => (o[k] ?? '') !== (r[k] ?? '')) || Number(o.quantity) !== Number(r.quantity)
          if (changed) {
            const u = await updateBulkOrderItem(r.id, {
              family_name: r.family_name, color: r.color, item_type: r.item_type,
              size: r.size, specs: r.specs, quantity: r.quantity,
              is_stock: r.is_stock, order_id: r.order_id,
            })
            if (!u.ok) throw new Error(u.error)
          }
        }
      }
      setSaving(false); onSaved?.(bulkOrderId)
    } catch (e) { setSaving(false); setErr(String(e?.message || e)) }
  }

  const title = isEdit ? (poNumber || 'Edit PR') : isRecord ? 'Record an existing Stone PR' : 'New Stone PR'

  return (
    <div className="prw-overlay">
      <style>{PRW_CSS}</style>
      <div className="prw-top">
        <div className="prw-top-l">
          <div className="prw-eyebrow">{isEdit ? 'Edit Stone PR' : isRecord ? 'Record existing — never touches orders' : 'Build and send'}</div>
          <h2 className="prw-title">{title}</h2>
        </div>
        <div className="prw-top-r">
          {err && <span className="prw-err">{err}</span>}
          <button type="button" className="sb-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="sb-btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : isRecord ? 'Record PR' : 'Save PR'}
          </button>
        </div>
      </div>

      <div className="prw-meta">
        <div className="prw-meta-item prw-meta-sup">
          <label className="prw-l">Supplier</label>
          <div className="prw-sup-row">
            <select className="sb-input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">{isEdit && supplierName ? supplierName : '— pick a supplier —'}</option>
              {suppliers.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" className="prw-mini" onClick={() => setShowNewSup(v => !v)}>{showNewSup ? '×' : '+ New'}</button>
          </div>
          {showNewSup && (
            <div className="prw-sup-row" style={{ marginTop: 6 }}>
              <input className="sb-input" placeholder="Supplier name" value={newSupName} onChange={e => setNewSupName(e.target.value)} />
              <button type="button" className="prw-mini" onClick={saveNewSupplier}>Save</button>
            </div>
          )}
        </div>
        <div className="prw-meta-item"><label className="prw-l">{isRecord ? 'Date ordered' : 'Date'}</label>
          <input type="date" className="sb-input" value={placedAt} onChange={e => setPlacedAt(e.target.value)} /></div>
        <div className="prw-meta-item"><label className="prw-l">Requested delivery</label>
          <input type="date" className="sb-input" value={eta} onChange={e => setEta(e.target.value)} /></div>
        <div className="prw-meta-item prw-meta-notes"><label className="prw-l">Notes</label>
          <input className="sb-input" placeholder="PR notes (prints on the sheet)" value={notes} onChange={e => setNotes(e.target.value)} /></div>
      </div>

      <div className="prw-body">
        {/* ── LEFT: the PR lines ── */}
        <div className="prw-left">
          {loading ? <div className="sb-empty">Loading the PR…</div> : (
            <>
              <table className="prw-table">
                <thead><tr>
                  <th className="prw-c-fam">Family</th><th className="prw-c-color">Color</th>
                  <th className="prw-c-type">Type</th><th className="prw-c-size">Size</th>
                  <th>Specs</th><th className="prw-c-qty">Qty</th>
                  <th className="prw-c-stock">Stock</th><th className="prw-c-link">Order</th><th />
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className={r.is_stock ? 'prw-row-stock' : ''}>
                      <td><input className="sb-input" value={r.family_name} disabled={r.is_stock}
                        placeholder={r.is_stock ? 'Stock' : 'Family'} onChange={e => setRow(r.id, { family_name: e.target.value })} /></td>
                      <td><input className="sb-input" value={r.color} placeholder="Md Barre" onChange={e => setRow(r.id, { color: e.target.value })} /></td>
                      <td><input className="sb-input" list="prw-types" value={r.item_type} placeholder="Die" onChange={e => setRow(r.id, { item_type: e.target.value })} /></td>
                      <td><input className="sb-input prw-mono" value={r.size} placeholder="2-0 x 1-0 x 0-8" onChange={e => setRow(r.id, { size: e.target.value })} /></td>
                      <td><input className="sb-input prw-mono" value={r.specs} placeholder="Pol Top; Saw Back; BRP" onChange={e => setRow(r.id, { specs: e.target.value })} /></td>
                      <td><input className="sb-input prw-qty" type="number" min="1" value={r.quantity} onChange={e => setRow(r.id, { quantity: e.target.value })} /></td>
                      <td className="prw-c-stock">
                        <button type="button" className={`prw-stock${r.is_stock ? ' on' : ''}`} title="Stock = ordered to have; lands as available yard stock on receive"
                          onClick={() => toggleStock(r)}>{r.is_stock ? 'STOCK' : '—'}</button>
                      </td>
                      <td className="prw-c-link">
                        {r.order_id
                          ? <span className="prw-linked" title="Linked to this order">{r.order_number || orderNoById.get(r.order_id) || 'linked'}
                              <button type="button" className="prw-unlink" title="Unlink" onClick={() => setRow(r.id, { order_id: null, order_number: null })}>×</button></span>
                          : railSel && !r.is_stock
                            ? <button type="button" className="prw-mini" title={`Link to ${famOfRow(railSel)}`} onClick={() => linkRowToRail(r)}>Link</button>
                            : <span className="prw-nolink">—</span>}
                      </td>
                      <td><button type="button" className="prw-rm" title="Remove line" onClick={() => removeRow(r.id)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="prw-types">{TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
              <div className="prw-addrow">
                <button type="button" className="prw-add" onClick={() => addRow()}>+ Add line</button>
                <button type="button" className="prw-add" onClick={() => addRow({ is_stock: true, family_name: 'Stock' })}>+ Add stock line</button>
              </div>
              {isRecord && <div className="prw-recnote">Recording only — this PR lands as Ordered for receiving, and never changes any order's data or status. Mismatches surface in the Reconcile tab for your call.</div>}
            </>
          )}
        </div>

        {/* ── RIGHT: the order rail ── */}
        <div className="prw-rail">
          <div className="prw-rail-head">Orders — confirm sizes against the record</div>
          <input className="sb-input" type="search" placeholder="Search family or order #…" value={railQ} onChange={e => setRailQ(e.target.value)} />
          {railQ.trim() && !railSel && (
            <div className="prw-rail-results">
              {orders == null ? <div className="prw-rail-muted">Loading orders…</div>
                : railResults.length === 0 ? <div className="prw-rail-muted">No open orders match.</div>
                : railResults.map(o => (
                  <button key={o.id} type="button" className="prw-rail-row" onClick={() => { setRailSel(o); }}>
                    <span className="prw-rail-fam">{famOfRow(o)}</span>
                    <span className="prw-rail-meta">{o.order_number}{o.status ? ` · ${o.status}` : ''}</span>
                  </button>
                ))}
            </div>
          )}
          {railSel && (
            <div className="prw-rail-order">
              <div className="prw-rail-order-head">
                <div>
                  <div className="prw-rail-fam" style={{ fontSize: 15 }}>{famOfRow(railSel)}</div>
                  <div className="prw-rail-meta">{railSel.order_number} · {railSel.status}{railSel.signed_at ? ` · signed ${String(railSel.signed_at).slice(0, 10)}` : ''}</div>
                </div>
                <button type="button" className="prw-mini" onClick={() => { setRailSel(null); setRailQ('') }}>× Close</button>
              </div>

              <div className="prw-rail-sec">Stone on the contract</div>
              {(railOrder?.needs || []).length === 0 && <div className="prw-rail-muted">No die/base spec on this order (service-only or no shape).</div>}
              {(railOrder?.needs || []).map(n => (
                <div key={n.key} className="prw-need">
                  <div className="prw-need-main">
                    <span className="prw-need-kind">{n.kind === 'base' ? 'BASE' : 'DIE'}</span>
                    <span className="prw-mono prw-need-size">{n.size || '—'}</span>
                    {n.color && <span className="prw-rail-meta">{n.color}</span>}
                  </div>
                  {(n.top || n.sides) && <div className="prw-rail-meta">{[n.top, n.sides].filter(Boolean).join(' · ')}</div>}
                  <div className="prw-rail-meta prw-need-spec">{n.spec}</div>
                  <button type="button" className="prw-mini prw-need-add" onClick={() => insertNeed(n)}>Insert as line →</button>
                </div>
              ))}

              <div className="prw-rail-sec">Files on the order</div>
              {railFiles == null ? <div className="prw-rail-muted">Loading files…</div>
                : railFiles.length === 0 ? <div className="prw-rail-muted">No files on this order.</div>
                : railFiles.slice(0, 12).map(f => (
                  <a key={f.id || f.file_url} className="prw-file" href={f.file_url} target="_blank" rel="noreferrer">
                    {f.category ? `[${f.category}] ` : ''}{f.filename || f.file_url}
                  </a>
                ))}
              <div className="prw-rail-hint">Tip: with an order open here, each unlinked PR line shows a Link button.</div>
            </div>
          )}
          {!railSel && !railQ.trim() && (
            <div className="prw-rail-muted" style={{ marginTop: 10 }}>
              Search an order to see its die and base sizes, color, and files — confirm what you're ordering against the signed record, then Insert or Link.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PRW_CSS = `
  .prw-overlay { position: fixed; inset: 0; z-index: 1290; background: var(--sb-bg, #F7F4EC); display: flex; flex-direction: column; overflow: hidden; }
  .prw-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 22px 10px; border-bottom: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface, #fff); flex-wrap: wrap; }
  .prw-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sb-text-muted, #8a7f6c); }
  .prw-title { margin: 2px 0 0; font-size: 20px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .prw-top-r { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .prw-err { color: #b3261e; font-size: 13px; font-weight: 600; max-width: 480px; }
  .prw-meta { display: flex; gap: 14px; padding: 10px 22px; background: var(--sb-surface, #fff); border-bottom: 1px solid var(--sb-border, #e4e0d4); flex-wrap: wrap; align-items: flex-end; }
  .prw-meta-item { min-width: 150px; }
  .prw-meta-sup { min-width: 260px; }
  .prw-meta-notes { flex: 1; min-width: 220px; }
  .prw-l { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); margin-bottom: 3px; }
  .prw-sup-row { display: flex; gap: 6px; }
  .prw-mini { font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 7px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #6b5d3a; cursor: pointer; white-space: nowrap; }
  .prw-mini:hover { border-color: #9A7209; color: #9A7209; }

  .prw-body { flex: 1; display: flex; gap: 0; overflow: hidden; }
  .prw-left { flex: 1.6; overflow-y: auto; padding: 16px 18px 40px 22px; }
  .prw-rail { flex: 1; max-width: 420px; min-width: 320px; border-left: 1px solid var(--sb-border, #e4e0d4); background: var(--sb-surface, #fff); overflow-y: auto; padding: 14px 18px 40px; }

  .prw-table { width: 100%; border-collapse: collapse; }
  .prw-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); padding: 4px 6px; }
  .prw-table td { padding: 4px 6px; vertical-align: middle; }
  .prw-table .sb-input { font-size: 13px; width: 100%; }
  .prw-mono { font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .prw-c-fam { width: 15%; } .prw-c-color { width: 11%; } .prw-c-type { width: 9%; } .prw-c-size { width: 17%; }
  .prw-c-qty { width: 58px; } .prw-qty { text-align: center; }
  .prw-c-stock { width: 62px; text-align: center; } .prw-c-link { width: 96px; }
  .prw-row-stock td { background: #f6f3ea; }
  .prw-stock { font: inherit; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; border-radius: 999px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #9a948a; padding: 3px 9px; cursor: pointer; }
  .prw-stock.on { background: #6b5d3a; border-color: #6b5d3a; color: #fff; }
  .prw-linked { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; font-weight: 700; color: #1f7a3d; background: #e7f3ea; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .prw-unlink { background: none; border: none; color: #1f7a3d; font-size: 13px; cursor: pointer; line-height: 1; padding: 0; }
  .prw-nolink { color: #c9c3b4; }
  .prw-rm { background: none; border: none; color: #b3261e; font-size: 17px; cursor: pointer; line-height: 1; }
  .prw-addrow { display: flex; gap: 10px; margin-top: 12px; }
  .prw-add { background: none; border: 1px dashed var(--sb-border, #d8d2c4); border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; color: #6b5d3a; padding: 8px 14px; cursor: pointer; }
  .prw-add:hover { background: var(--sb-surface, #fff); }
  .prw-recnote { margin-top: 14px; font-size: 12.5px; color: #6d49b8; background: #ede8f7; border-radius: 9px; padding: 9px 12px; }

  .prw-rail-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #8a7f6c); margin-bottom: 8px; }
  .prw-rail-results { margin-top: 8px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; overflow: hidden; }
  .prw-rail-row { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; font: inherit; background: none; border: none; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); padding: 8px 11px; cursor: pointer; }
  .prw-rail-row:hover { background: #faf8f3; }
  .prw-rail-row:last-child { border-bottom: 0; }
  .prw-rail-fam { font-size: 13.5px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .prw-rail-meta { font-size: 11.5px; color: var(--sb-text-muted, #8a7f6c); }
  .prw-rail-muted { font-size: 12.5px; color: var(--sb-text-muted, #9a948a); padding: 8px 2px; }
  .prw-rail-order { margin-top: 10px; }
  .prw-rail-order-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .prw-rail-sec { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #6b5d3a; margin: 14px 0 6px; border-bottom: 1px solid var(--sb-border-soft, #f0ece2); padding-bottom: 3px; }
  .prw-need { border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; }
  .prw-need-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .prw-need-kind { font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em; color: #6b5d3a; background: #f4efe4; border-radius: 4px; padding: 1px 6px; }
  .prw-need-size { font-size: 13px; font-weight: 700; }
  .prw-need-spec { margin-top: 2px; font-family: var(--font-m, 'JetBrains Mono'), monospace; font-size: 11px; }
  .prw-need-add { margin-top: 6px; }
  .prw-file { display: block; font-size: 12.5px; color: #2563a8; padding: 3px 0; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prw-file:hover { text-decoration: underline; }
  .prw-rail-hint { margin-top: 12px; font-size: 11.5px; color: var(--sb-text-muted, #9a948a); }

  @media (max-width: 900px) { .prw-body { flex-direction: column; } .prw-rail { max-width: none; border-left: none; border-top: 1px solid var(--sb-border, #e4e0d4); } }
`
