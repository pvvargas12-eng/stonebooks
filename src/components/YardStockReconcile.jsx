// =============================================================================
// YardStockReconcile — yard stock vs orders (Reconcile tab, 2026-08-03)
// =============================================================================
// Paul's inventory crisis: 75 allocated yard stones carried free-text names
// and ZERO real order links, so no surface could prove "this order's stone is
// already here" — and the shop kept re-ordering. This section links them:
//   • Not linked yet → name-matched candidates from OPEN orders; one click
//     links (sets inventory_stock.allocated_order_id). "Link all" covers every
//     single-candidate row at once. NOTHING links itself — Paul clicks.
//   • No matching open order → the stale-assignment flag he asked for
//     ("if there are names assigned that arent in stonebooks I NEED TO KNOW").
//   • Missing — flagged from the field yard count; his call what happens.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getInventoryStock, listOpenOrdersLight, linkYardStockToOrder,
  updateInventoryItem, restoreYardStockStatus, properName, customerName, fmtDate,
} from '../lib/stonebooksData'

// Loose token match: "CRUZ ISABEL" ↔ primary_lastname "Cruz", "Amalia Kaufman"
// ↔ customer Kaufman. 3+ letter tokens only so initials never false-match.
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)
const nameMatches = (assigned, order) => {
  const a = tokens(assigned)
  if (!a.length) return false
  const target = new Set([
    ...tokens(order.primary_lastname),
    ...tokens(order.customer?.last_name),
    ...tokens(order.customer?.first_name),
  ])
  return a.some(t => target.has(t))
}

export default function YardStockReconcile({ onOpenOrder }) {
  const [stock, setStock] = useState(null)
  const [orders, setOrders] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showLinked, setShowLinked] = useState(false)

  const load = useCallback(async () => {
    const [st, ords] = await Promise.all([
      getInventoryStock().then(r => (Array.isArray(r) ? r : (r?.rows || []))).catch(() => []),
      listOpenOrdersLight().catch(() => []),
    ])
    setStock(st)
    setOrders(ords)
  }, [])
  useEffect(() => { load() }, [load])

  const orderById = useMemo(() => new Map((orders || []).map(o => [o.id, o])), [orders])

  const buckets = useMemo(() => {
    if (!stock || !orders) return null
    const allocated = stock.filter(r => r.status === 'allocated')
    const missing = stock.filter(r => r.status === 'missing')
    const linked = allocated.filter(r => r.allocated_order_id)
    const unlinked = allocated.filter(r => !r.allocated_order_id).map(r => {
      const candidates = orders.filter(o => nameMatches(r.assigned_to, o))
      return { row: r, candidates }
    })
    return {
      linked,
      one: unlinked.filter(u => u.candidates.length === 1),
      many: unlinked.filter(u => u.candidates.length > 1),
      none: unlinked.filter(u => u.candidates.length === 0),
      missing,
    }
  }, [stock, orders])

  const link = async (rowId, orderId) => {
    if (busyId) return
    setBusyId(rowId); setMsg(null)
    const r = await linkYardStockToOrder(rowId, orderId)
    setBusyId(null)
    if (!r.ok) { setMsg({ error: true, text: r.error }); return }
    setStock(prev => prev.map(x => (x.id === rowId ? { ...x, allocated_order_id: orderId } : x)))
  }
  const linkAllSingles = async () => {
    if (bulkBusy || !buckets) return
    setBulkBusy(true); setMsg(null)
    let done = 0
    for (const u of buckets.one) {
      const r = await linkYardStockToOrder(u.row.id, u.candidates[0].id)
      if (r.ok) { done++; setStock(prev => prev.map(x => (x.id === u.row.id ? { ...x, allocated_order_id: u.candidates[0].id } : x))) }
    }
    setBulkBusy(false)
    setMsg({ error: false, text: `Linked ${done} stone${done === 1 ? '' : 's'} to their orders.` })
  }
  const makeAvailable = async (rowId) => {
    if (busyId) return
    setBusyId(rowId); setMsg(null)
    const r = await updateInventoryItem(rowId, { status: 'available' })
    setBusyId(null)
    if (!r.ok) { setMsg({ error: true, text: r.error }); return }
    setStock(prev => prev.map(x => (x.id === rowId ? { ...x, status: 'available', assigned_to: null, allocated_order_id: null } : x)))
  }
  const restoreMissing = async (row) => {
    if (busyId) return
    setBusyId(row.id); setMsg(null)
    const r = await restoreYardStockStatus(row.id, row.assigned_to ? 'allocated' : 'available')
    setBusyId(null)
    if (!r.ok) { setMsg({ error: true, text: r.error }); return }
    load()
  }

  const pieceOf = (r) => [r.item_type, r.size, r.color].filter(Boolean).join(' · ')
  const ordLabel = (o) => `${properName(o.primary_lastname || customerName(o.customer) || '—')}${o.order_number ? ` · ${o.order_number}` : ''}`

  if (!buckets) return <section className="ysr"><style>{CSS}</style><div className="ysr-empty">Loading yard stock…</div></section>

  const needCount = buckets.one.length + buckets.many.length + buckets.none.length + buckets.missing.length

  return (
    <section className="ysr">
      <style>{CSS}</style>
      <div className="ysr-head">
        <div>
          <h3 className="ysr-title">Yard stock vs orders</h3>
          <div className="ysr-sub">
            Every allocated stone should point at a REAL open order — that's how Needs Ordering knows it's already here.
            Linked {buckets.linked.length} · needs you {needCount}.
          </div>
        </div>
        <div className="ysr-actions">
          {buckets.one.length > 0 && (
            <button type="button" className="ysr-btn ysr-btn-gold" disabled={bulkBusy} onClick={linkAllSingles}>
              {bulkBusy ? 'Linking…' : `Link all ${buckets.one.length} exact matches`}
            </button>
          )}
          <button type="button" className="ysr-btn" onClick={load}>Refresh</button>
        </div>
      </div>
      {msg && <div className={`ysr-msg${msg.error ? ' err' : ''}`}>{msg.text}</div>}

      {buckets.missing.length > 0 && (
        <div className="ysr-block ysr-block-red">
          <div className="ysr-block-h">Flagged MISSING on the yard count — your call</div>
          {buckets.missing.map(r => (
            <div key={r.id} className="ysr-row">
              <span className="ysr-piece">{pieceOf(r)}</span>
              <span className="ysr-name">{r.assigned_to ? `was for ${properName(r.assigned_to)}` : 'unassigned'}</span>
              {r.verified_by && <span className="ysr-meta">flagged by {r.verified_by}{r.verified_at ? ` · ${fmtDate(r.verified_at)}` : ''}</span>}
              <span className="ysr-rowactions">
                <button type="button" className="ysr-btn" disabled={busyId === r.id} onClick={() => restoreMissing(r)}>Found it — restore</button>
                <button type="button" className="ysr-btn" disabled={busyId === r.id} onClick={() => makeAvailable(r.id)}>Make available</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {buckets.none.length > 0 && (
        <div className="ysr-block ysr-block-red">
          <div className="ysr-block-h">Assigned to a name with NO open order in Stonebooks</div>
          {buckets.none.map(({ row: r }) => (
            <div key={r.id} className="ysr-row">
              <span className="ysr-piece">{pieceOf(r)}</span>
              <span className="ysr-name">{properName(r.assigned_to || '—')}</span>
              <span className="ysr-rowactions">
                <button type="button" className="ysr-btn" disabled={busyId === r.id} onClick={() => makeAvailable(r.id)}>Make available stock</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {buckets.many.length > 0 && (
        <div className="ysr-block">
          <div className="ysr-block-h">Same name, several open orders — pick which one</div>
          {buckets.many.map(({ row: r, candidates }) => (
            <div key={r.id} className="ysr-row ysr-row-wrap">
              <span className="ysr-piece">{pieceOf(r)}</span>
              <span className="ysr-name">{properName(r.assigned_to || '—')}</span>
              <span className="ysr-cands">
                {candidates.slice(0, 5).map(o => (
                  <span key={o.id} className="ysr-cand">
                    <button type="button" className="ysr-cand-open" onClick={() => onOpenOrder?.(o.id)}>{ordLabel(o)}</button>
                    <button type="button" className="ysr-btn ysr-btn-gold" disabled={busyId === r.id} onClick={() => link(r.id, o.id)}>This one</button>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {buckets.one.length > 0 && (
        <div className="ysr-block">
          <div className="ysr-block-h">One clear match — one click each (or Link all above)</div>
          {buckets.one.map(({ row: r, candidates }) => (
            <div key={r.id} className="ysr-row">
              <span className="ysr-piece">{pieceOf(r)}</span>
              <span className="ysr-name">{properName(r.assigned_to || '—')}</span>
              <button type="button" className="ysr-cand-open" onClick={() => onOpenOrder?.(candidates[0].id)}>{ordLabel(candidates[0])}</button>
              <span className="ysr-rowactions">
                <button type="button" className="ysr-btn ysr-btn-gold" disabled={busyId === r.id} onClick={() => link(r.id, candidates[0].id)}>
                  {busyId === r.id ? '…' : 'Link'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="ysr-block ysr-block-quiet">
        <button type="button" className="ysr-toggle" onClick={() => setShowLinked(v => !v)}>
          {buckets.linked.length} linked and verified against orders {showLinked ? '▴' : '▾'}
        </button>
        {showLinked && buckets.linked.map(r => {
          const o = orderById.get(r.allocated_order_id)
          return (
            <div key={r.id} className="ysr-row">
              <span className="ysr-piece">{pieceOf(r)}</span>
              <span className="ysr-name">{properName(r.assigned_to || '—')}</span>
              {o
                ? <button type="button" className="ysr-cand-open" onClick={() => onOpenOrder?.(o.id)}>{ordLabel(o)}</button>
                : <span className="ysr-meta">order not open anymore</span>}
              <span className="ysr-rowactions">
                <button type="button" className="ysr-btn" disabled={busyId === r.id} onClick={() => link(r.id, null)}>Unlink</button>
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const CSS = `
  .ysr { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E6E1D4); border-radius: 12px; padding: 16px 18px; margin-bottom: 18px; }
  .ysr-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; }
  .ysr-title { font-size: 16px; font-weight: 700; margin: 0; }
  .ysr-sub { font-size: 12.5px; color: #8a8472; margin-top: 3px; max-width: 560px; }
  .ysr-actions { display: flex; gap: 8px; }
  .ysr-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 0.5px solid #DCD6C8; background: #fff; color: #2a2a27; cursor: pointer; white-space: nowrap; }
  .ysr-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .ysr-btn:disabled { opacity: 0.5; }
  .ysr-btn-gold { background: #9A7209; border-color: #9A7209; color: #fff; }
  .ysr-btn-gold:hover:not(:disabled) { background: #7d5d07; color: #fff; }
  .ysr-msg { font-size: 12.5px; font-weight: 600; color: #1d7a55; margin: 6px 0; }
  .ysr-msg.err { color: #B3261E; }
  .ysr-block { border-top: 0.5px solid #F0ECE2; padding: 10px 0 4px; }
  .ysr-block-red { background: #FFF7F6; border: 0.5px solid #EFC5C1; border-left: 4px solid #B3261E; border-radius: 10px; padding: 10px 12px; margin: 10px 0; }
  .ysr-block-h { font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: #6b6456; margin-bottom: 6px; }
  .ysr-block-red .ysr-block-h { color: #B3261E; }
  .ysr-row { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-top: 0.5px solid #F6F3EA; flex-wrap: wrap; }
  .ysr-row:first-of-type { border-top: none; }
  .ysr-piece { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #55503F; min-width: 210px; }
  .ysr-name { font-size: 13px; font-weight: 700; min-width: 130px; }
  .ysr-meta { font-size: 11.5px; color: #8a8472; }
  .ysr-rowactions { margin-left: auto; display: flex; gap: 6px; }
  .ysr-cands { display: flex; gap: 10px; flex-wrap: wrap; }
  .ysr-cand { display: inline-flex; align-items: center; gap: 5px; }
  .ysr-cand-open { font: inherit; font-size: 12.5px; font-weight: 600; color: #185F8F; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .ysr-cand-open:hover { color: #9A7209; }
  .ysr-block-quiet { color: #8a8472; }
  .ysr-toggle { font: inherit; font-size: 12.5px; font-weight: 700; color: #1d7a55; background: none; border: none; padding: 4px 0; cursor: pointer; }
  .ysr-empty { font-size: 13px; color: #8a8472; padding: 8px 0; }
`
