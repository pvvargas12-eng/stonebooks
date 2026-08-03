// =============================================================================
// InventoryScreen — yard stock from the phone: add, receive, adjust, UNDO
// =============================================================================
// Rides the SAME inventory_stock table + helpers as the desktop Inventory tab
// (getInventoryStock / addInventoryItem / updateInventoryItem) — one source of
// truth. Receive = qty bump w/ confirm; every write offers UNDO (patches the
// previous values back).
//
// COUNT THE YARD (Paul 2026-08-03: "GIVE ME A SYSTEM... BY GOING TO MY YARD
// AND CONFIRMING THROUGH STONEBOOKS FIELD"): a walk-the-yard mode — every
// stone gets FOUND (stamps verified_at/by = the phone's person) or NOT HERE
// (flags missing; Reconcile decides). Unconfirmed rows list first, progress
// on top, allocated rows show whose stone it is so the assignment gets eyes
// too. The verified stamp is what makes every other surface trustworthy.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryStock, addInventoryItem, updateInventoryItem,
  verifyYardStock, restoreYardVerification, flagYardStockMissing, restoreYardStockStatus,
  getActiveStaffUser, properName,
} from '../lib/stonebooksData'

const STATUS_CHIP = {
  available: 'fl-c-good',
  allocated: 'fl-c-info',
  hold:      'fl-c-warn',
  missing:   'fl-c-bad',
}
const DAY_MS = 86400000
// A verification older than 90 days counts as unconfirmed on the walk.
const FRESH_MS = 90 * DAY_MS

export default function InventoryScreen({ undo }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [receiving, setReceiving] = useState(null)   // item being received
  const [counting, setCounting] = useState(false)    // Count-the-yard mode
  const [countBusy, setCountBusy] = useState(null)
  // Stamped once when the count starts — the freshness line (React 19 purity).
  const [nowMs, setNowMs] = useState(0)

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

  const isFresh = useCallback((it) => {
    if (!it.verified_at || !nowMs) return false
    const t = Date.parse(it.verified_at)
    return Number.isFinite(t) && nowMs - t < FRESH_MS
  }, [nowMs])

  const list = useMemo(() => {
    if (!items) return []
    const needle = q.trim().toLowerCase()
    let l = items
    if (needle) {
      l = l.filter(it =>
        [it.item_type, it.color, it.size, it.location, it.notes, it.status, it.assigned_to]
          .filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    if (counting) {
      // Walk order: unconfirmed first, grouped by location so the walk flows.
      l = [...l].sort((a, b) =>
        ((isFresh(a) ? 1 : 0) - (isFresh(b) ? 1 : 0))
        || String(a.location || '~').localeCompare(String(b.location || '~'))
        || String(a.item_type || '').localeCompare(String(b.item_type || '')))
    }
    return l
  }, [items, q, counting, isFresh])

  // FOUND — one tap, stamps who + when; undo restores the exact prior stamp.
  const markFound = async (it) => {
    if (countBusy) return
    setCountBusy(it.id)
    const prev = { verified_at: it.verified_at || null, verified_by: it.verified_by || null }
    const by = getActiveStaffUser() || null
    const r = await verifyYardStock(it.id, { by })
    setCountBusy(null)
    if (!r.ok) { undo.showError(r.error || 'Could not confirm.'); return }
    refresh()
    undo.show(`${[it.item_type, it.size].filter(Boolean).join(' ')} confirmed`, async () => {
      await restoreYardVerification(it.id, prev).catch(() => {})
      refresh()
    })
  }
  // NOT HERE — flags missing (keeps the assignment); Reconcile decides.
  const markMissing = async (it) => {
    if (countBusy) return
    setCountBusy(it.id)
    const prevStatus = it.status
    const by = getActiveStaffUser() || null
    const r = await flagYardStockMissing(it.id, { by })
    setCountBusy(null)
    if (!r.ok) { undo.showError(r.error || 'Could not flag it.'); return }
    refresh()
    undo.show(`${[it.item_type, it.size].filter(Boolean).join(' ')} flagged missing`, async () => {
      await restoreYardStockStatus(it.id, prevStatus).catch(() => {})
      refresh()
    })
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (items === null) return <div className="fl-empty">Loading inventory…</div>

  const countable = items.filter(it => it.status !== 'missing')
  const confirmed = countable.filter(isFresh).length

  return (
    <div>
      <input className="fl-search" type="search" placeholder="Search type, color, size, location, name"
        value={q} onChange={e => setQ(e.target.value)} />

      {/* COUNT THE YARD — the trust walk. */}
      <button type="button" className={counting ? 'fl-btn fl-btn-green' : 'fl-btn'}
        onClick={() => { setCounting(v => !v); setNowMs(Date.now()); setAdding(false) }}>
        {counting ? `Counting — ${confirmed}/${countable.length} confirmed · tap to stop` : 'Count the yard'}
      </button>
      {counting && (
        <div className="fl-spec" style={{ margin: '-4px 2px 10px', fontFamily: 'inherit' }}>
          Walk the rows. FOUND stamps your name on the stone; NOT HERE sends it to Reconcile.
          Unconfirmed stones list first. Anything you find that is not in the list — add it below.
        </div>
      )}

      {adding ? (
        <AddItemForm undo={undo} onDone={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />
      ) : (
        <button type="button" className="fl-btn" onClick={() => setAdding(true)}>+ Add stock item</button>
      )}

      {list.length === 0 && <div className="fl-empty">Nothing in stock matches.</div>}
      {list.map(it => {
        const fresh = isFresh(it)
        return (
        <div key={it.id} className="fl-row" style={{ cursor: 'default', ...(counting && fresh ? { opacity: 0.62 } : null) }}>
          <div className="fl-row-flex">
            <div className="fl-row-main">
              <div className="fl-fam" style={{ fontSize: 14.5 }}>
                {[it.item_type, it.color].filter(Boolean).join(' · ') || 'Item'}
              </div>
              <div className="fl-spec">{[it.size, it.location && `@ ${it.location}`].filter(Boolean).join(' · ') || '—'}</div>
              {it.assigned_to && (
                <div className="fl-spec" style={{ fontFamily: 'inherit', fontWeight: 700 }}>
                  for {properName(it.assigned_to)}
                </div>
              )}
            </div>
            <div className={`fl-inv-qty${Number(it.quantity) <= 0 ? ' fl-inv-low' : ''}`}>
              <small>QTY</small>{Number(it.quantity) || 0}
            </div>
          </div>
          <div className="fl-chips">
            <span className={`fl-chip ${STATUS_CHIP[it.status] || 'fl-c-neutral'}`}>{String(it.status || 'unknown').toUpperCase()}</span>
            {it.verified_at && (
              <span className={`fl-chip ${fresh ? 'fl-c-good' : 'fl-c-neutral'}`}>
                SEEN {String(it.verified_at).slice(5, 10).replace('-', '/')}{it.verified_by ? ` · ${it.verified_by.toUpperCase()}` : ''}
              </span>
            )}
            {counting && it.status !== 'missing' ? (
              <>
                <button type="button" className="fl-verb" style={{ borderColor: '#1d7a55', color: '#1d7a55' }}
                  disabled={countBusy === it.id} onClick={() => markFound(it)}>
                  {countBusy === it.id ? '…' : 'FOUND'}
                </button>
                <button type="button" className="fl-verb" style={{ borderColor: '#B3261E', color: '#B3261E' }}
                  disabled={countBusy === it.id} onClick={() => markMissing(it)}>
                  NOT HERE
                </button>
                <button type="button" className="fl-event-undo" onClick={() => setReceiving(it)}>Fix</button>
              </>
            ) : receiving?.id === it.id ? null : (
              <button type="button" className="fl-event-undo" onClick={() => setReceiving(it)}>Receive / adjust</button>
            )}
          </div>
          {receiving?.id === it.id && (
            <ReceiveForm item={it} undo={undo}
              onDone={() => { setReceiving(null); refresh() }}
              onCancel={() => setReceiving(null)} />
          )}
        </div>
        )
      })}
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
