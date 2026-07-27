// =============================================================================
// InventoryScreen — yard stock from the phone: add, receive, adjust, UNDO
// =============================================================================
// Rides the SAME inventory_stock table + helpers as the desktop Inventory tab
// (getInventoryStock / addInventoryItem / updateInventoryItem) — one source of
// truth. Receive = qty bump w/ confirm; every write offers UNDO (patches the
// previous values back).
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { getInventoryStock, addInventoryItem, updateInventoryItem } from '../lib/stonebooksData'

const STATUS_CHIP = {
  available: 'fl-c-good',
  allocated: 'fl-c-info',
  hold:      'fl-c-warn',
}

export default function InventoryScreen({ undo }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [receiving, setReceiving] = useState(null)   // item being received

  // getInventoryStock resolves { ok, rows, error } — NOT an array. Treating it
  // as one made items an object, so list.map() threw and took the whole app
  // down when Paul opened Inventory (2026-07-27). Unwrap .rows, tolerate a
  // bare array, and surface the helper's own error instead of crashing.
  const refresh = useCallback(() => {
    getInventoryStock()
      .then(res => {
        if (Array.isArray(res)) { setItems(res); return }
        if (res && res.ok === false) { setErr(res.error || 'Could not load inventory.'); setItems([]); return }
        setItems(res?.rows || [])
      })
      .catch(e => setErr(e?.message || 'Could not load inventory.'))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const list = useMemo(() => {
    if (!items) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(it =>
      [it.item_type, it.color, it.size, it.location, it.notes, it.status]
        .filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [items, q])

  if (err) return <div className="fl-empty">{err}</div>
  if (items === null) return <div className="fl-empty">Loading inventory…</div>

  return (
    <div>
      <input className="fl-search" type="search" placeholder="Search type, color, size, location"
        value={q} onChange={e => setQ(e.target.value)} />

      {adding ? (
        <AddItemForm undo={undo} onDone={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="fl-btn" onClick={() => setAdding(true)}>+ Add stock item</button>
      )}

      {list.length === 0 && <div className="fl-empty">Nothing in stock matches.</div>}
      {list.map(it => (
        <div key={it.id} className="fl-row" style={{ cursor: 'default' }}>
          <div className="fl-row-flex">
            <div className="fl-row-main">
              <div className="fl-fam" style={{ fontSize: 14.5 }}>
                {[it.item_type, it.color].filter(Boolean).join(' · ') || 'Item'}
              </div>
              <div className="fl-spec">{[it.size, it.location && `@ ${it.location}`].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <div className={`fl-inv-qty${Number(it.quantity) <= 0 ? ' fl-inv-low' : ''}`}>
              <small>QTY</small>{Number(it.quantity) || 0}
            </div>
          </div>
          <div className="fl-chips">
            <span className={`fl-chip ${STATUS_CHIP[it.status] || 'fl-c-neutral'}`}>{String(it.status || 'unknown').toUpperCase()}</span>
            {receiving?.id === it.id ? null : (
              <button type="button" className="fl-event-undo" onClick={() => setReceiving(it)}>Receive / adjust</button>
            )}
          </div>
          {receiving?.id === it.id && (
            <ReceiveForm item={it} undo={undo}
              onDone={() => { setReceiving(null); refresh() }}
              onCancel={() => setReceiving(null)} />
          )}
        </div>
      ))}
    </div>
  )
}

// Receive a shipment (or fix a count): +/- stepper, note, explicit CONFIRM.
// Undo patches the previous quantity/status straight back.
function ReceiveForm({ item, undo, onDone, onCancel }) {
  const [delta, setDelta] = useState(1)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!delta || busy) return
    setBusy(true)
    const prev = { quantity: Number(item.quantity) || 0, status: item.status }
    const nextQty = Math.max(0, prev.quantity + delta)
    const patch = { quantity: nextQty }
    if (delta > 0 && item.status !== 'allocated') patch.status = 'available'
    const res = await updateInventoryItem(item.id, patch).then(() => ({ ok: true })).catch(e => ({ ok: false, error: e?.message }))
    setBusy(false)
    if (!res.ok) { undo.showError(res.error || 'Could not update stock.'); return }
    undo.show(
      `${[item.item_type, item.color].filter(Boolean).join(' ')} qty ${prev.quantity} → ${nextQty}`,
      async () => { await updateInventoryItem(item.id, prev).catch(() => {}) }
    )
    onDone()
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #F0ECE2', paddingTop: 10 }}>
      <div className="fl-lab">{delta >= 0 ? 'Receiving' : 'Removing'} — confirm the count</div>
      <div className="fl-qtyrow" style={{ marginBottom: 8 }}>
        <button type="button" className="fl-qtybtn" onClick={() => setDelta(d => d - 1)}>−</button>
        <div className="fl-qtyval">{delta > 0 ? `+${delta}` : delta}</div>
        <button type="button" className="fl-qtybtn" onClick={() => setDelta(d => d + 1)}>+</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="fl-btn fl-btn-green" style={{ marginBottom: 0 }} onClick={confirm} disabled={busy || delta === 0}>
          {busy ? 'Saving…' : `Confirm ${delta > 0 ? '+' : ''}${delta}`}
        </button>
      </div>
    </div>
  )
}

function AddItemForm({ undo, onDone, onCancel }) {
  const [form, setForm] = useState({ item_type: '', color: '', size: '', location: '', quantity: 1, notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.item_type.trim() || busy) return
    setBusy(true)
    const res = await addInventoryItem({
      item_type: form.item_type.trim(),
      color: form.color.trim() || null,
      size: form.size.trim() || null,
      location: form.location.trim() || null,
      quantity: Number(form.quantity) || 0,
      notes: form.notes.trim() || null,
      status: 'available',
    }).then(r => ({ ok: true, row: r })).catch(e => ({ ok: false, error: e?.message }))
    setBusy(false)
    if (!res.ok) { undo.showError(res.error || 'Could not add the item.'); return }
    undo.show(`Added ${form.item_type.trim()} to stock`, res.row?.id
      ? async () => { await updateInventoryItem(res.row.id, { status: 'removed', quantity: 0 }).catch(() => {}) }
      : null)
    onDone()
  }

  return (
    <div className="fl-card">
      <div className="fl-eyebrow">New stock item</div>
      <div className="fl-lab">Type</div>
      <input className="fl-input" placeholder="e.g. Slant, Base, Marker" value={form.item_type} onChange={set('item_type')} />
      <div className="fl-lab">Color</div>
      <input className="fl-input" placeholder="e.g. Barre Gray" value={form.color} onChange={set('color')} />
      <div className="fl-lab">Size</div>
      <input className="fl-input" placeholder="e.g. 24-10-16" value={form.size} onChange={set('size')} />
      <div className="fl-lab">Location</div>
      <input className="fl-input" placeholder="e.g. Yard row 3" value={form.location} onChange={set('location')} />
      <div className="fl-lab">Quantity</div>
      <input className="fl-input" type="number" inputMode="numeric" min="0" value={form.quantity} onChange={set('quantity')} />
      <div className="fl-lab">Notes</div>
      <input className="fl-input" placeholder="Optional" value={form.notes} onChange={set('notes')} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="fl-btn fl-btn-ghost" style={{ marginBottom: 0 }} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="fl-btn" style={{ marginBottom: 0 }} onClick={save} disabled={busy || !form.item_type.trim()}>
          {busy ? 'Saving…' : 'Add to stock'}
        </button>
      </div>
    </div>
  )
}
