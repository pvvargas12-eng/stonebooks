// =============================================================================
// InventoryReconcile — PRs vs orders, differences surfaced, Paul decides.
// =============================================================================
// Paul's rule (2026-07-23): recorded/imported PRs must NEVER change order data
// by themselves. This tab shows every disagreement and he clicks:
//   1. PR says ordered, order says not      → Mark stone ordered / Disregard
//   2. PR line received, order not received → Mark stone received / Disregard
//   3. PR line with no matching order       → Link to an order / Disregard
//   4. Stock match — an order needs a stone that isn't here, but a STOCK stone
//      of that size is on an ordered PR     → informational / Disregard
// Fixes ride the SAME master-override stone ladder as every other surface
// (reconcileMarkStoneStatus); dismissals persist in pr_reconcile_dismissals.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getPRReconcile, dismissPRReconcile, reconcileMarkStoneStatus,
  updateBulkOrderItem, getActiveStoneOrders, getCurrentStaffName,
} from '../lib/stonebooksData'
import { rowToOrder } from '../SalesMode'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'

const famOfRow = (r) => (r.primary_lastname && String(r.primary_lastname).trim()) || r.order_number || 'Order'
const lineLabel = (it) => [it.item_type, it.size, it.color].filter(Boolean).join(' · ') || it.spec_text || '—'

export default function InventoryReconcile({ onOpenOrder = null }) {
  const [data, setData] = useState(null)
  const [orders, setOrders] = useState(null)
  const [banner, setBanner] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [linkFor, setLinkFor] = useState(null)   // item id with the link picker open
  const [linkQ, setLinkQ] = useState('')

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([
      getPRReconcile(),
      getActiveStoneOrders().catch(() => ({ rows: [] })),
    ])
    setData(r)
    setOrders(o.rows || [])
  }, [])
  useEffect(() => { load() }, [load])

  // Stock matches: open-order stone needs vs STOCK lines on ordered PRs, matched
  // with the SAME size/color/type comparators Smart Matches uses.
  const stockMatches = useMemo(() => {
    if (!data || !orders || !data.stockLines?.length) return []
    try {
      const mapped = orders.map(r => { const o = rowToOrder(r, null, null); o.family = famOfRow(r); return o })
      const needs = resolveStoneNeeds(mapped)
      const pseudoStock = data.stockLines.map(({ item, pr }) => ({
        id: item.id, item_type: item.item_type || 'custom', color: item.color, size: item.size,
        status: 'available', _pr: pr, _item: item,
      }))
      const dismissed = data.dismissedKeys || new Set()
      const out = []
      for (const m of matchNeedsToStock(needs, pseudoStock)) {
        if (!m.best || m.fulfilled) continue
        const s = m.best.stock
        const key = `stock:${m.need.orderId}:${m.need.kind}`
        if (dismissed.has(`${s.id}|${key}`)) continue
        out.push({ need: m.need, stockItem: s._item, pr: s._pr, strength: m.best.strength, dismissKey: key })
      }
      return out
    } catch { return [] }
  }, [data, orders])

  const linkResults = useMemo(() => {
    if (!orders || !linkQ.trim()) return []
    const t = linkQ.trim().toLowerCase()
    return orders.filter(o => `${o.primary_lastname || ''} ${o.order_number || ''}`.toLowerCase().includes(t)).slice(0, 10)
  }, [orders, linkQ])

  // Auto-suggested candidates per unmatched family (client-side, name contains).
  const candidatesFor = useCallback((fam) => {
    if (!orders) return []
    const t = String(fam || '').trim().toLowerCase()
    if (!t) return []
    return orders.filter(o => String(o.primary_lastname || '').toLowerCase().includes(t.split(',')[0].split(' ')[0])).slice(0, 4)
  }, [orders])

  const run = async (key, fn, okText) => {
    if (busyKey) return
    setBusyKey(key); setBanner(null)
    const r = await fn()
    setBusyKey(null)
    if (!r.ok) { setBanner({ kind: 'err', text: r.error || 'That change failed.' }); return }
    setBanner({ kind: 'ok', text: okText })
    load()
  }
  const disregard = async (itemId, checkKind, key) =>
    run(key, async () => dismissPRReconcile(itemId, checkKind, await getCurrentStaffName().catch(() => null)), 'Disregarded — it will not come back.')
  const markOrdered = (row) =>
    run(`o:${row.item.id}`, () => reconcileMarkStoneStatus(row.order.id, 'ordered'), `${famOfRow(row.order)} marked stone ordered.`)
  const markReceived = (row) =>
    run(`r:${row.item.id}`, () => reconcileMarkStoneStatus(row.order.id, 'needs_stencil_cut'), `${famOfRow(row.order)} marked stone received (needs stencil).`)
  const linkItem = (item, order) =>
    run(`l:${item.id}`, () => updateBulkOrderItem(item.id, { order_id: order.id, family_name: item.family_name || famOfRow(order) }),
      `Line linked to ${famOfRow(order)} (${order.order_number}).`).then(() => { setLinkFor(null); setLinkQ('') })

  if (data == null) return <div className="sb-empty">Comparing PRs against orders…</div>
  if (data.error) return <div className="sb-empty">Reconcile isn’t available.<br /><span className="irx-muted">{data.error}</span></div>

  const total = data.orderedMismatch.length + data.receivedMismatch.length + data.unmatched.length + stockMatches.length

  return (
    <div className="irx">
      <style>{IRX_CSS}</style>
      <div className="irx-sub">
        Nothing here changes an order by itself — every row is your call. Fixes use the same stone ladder as the Orders tab; Disregard is remembered.
      </div>
      {banner && <div className={`irx-banner irx-banner-${banner.kind}`}>{banner.text}<button type="button" className="irx-x" onClick={() => setBanner(null)}>×</button></div>}

      {total === 0 && <div className="sb-empty">Everything agrees — no PR/order differences to reconcile.</div>}

      {data.orderedMismatch.length > 0 && (
        <Section title="PR says ordered — order says not" tone="red" count={data.orderedMismatch.length}
          hint="The stone is on a submitted/ordered/recorded PR, but the order's stone status is still not-ordered.">
          {data.orderedMismatch.map(row => (
            <div key={row.item.id} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(row.order.id)}>{famOfRow(row.order)}</button>
              <span className="irx-meta">{row.order.order_number} · {lineLabel(row.item)} · on {row.pr?.po_number || 'PR'}{row.pr?.recorded ? ' (recorded)' : ''}</span>
              <span className="irx-actions">
                <button type="button" className="irx-btn irx-btn-go" disabled={!!busyKey} onClick={() => markOrdered(row)}>Mark stone ordered</button>
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(row.item.id, 'ordered', `d:${row.item.id}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {data.receivedMismatch.length > 0 && (
        <Section title="PR line received — order says stone not here" tone="amber" count={data.receivedMismatch.length}
          hint="The PR line was received into the yard, but the order still reads stone-not-received.">
          {data.receivedMismatch.map(row => (
            <div key={row.item.id} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(row.order.id)}>{famOfRow(row.order)}</button>
              <span className="irx-meta">{row.order.order_number} · {lineLabel(row.item)} · {row.pr?.po_number || 'PR'}</span>
              <span className="irx-actions">
                <button type="button" className="irx-btn irx-btn-go" disabled={!!busyKey} onClick={() => markReceived(row)}>Mark stone received</button>
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(row.item.id, 'received', `d:${row.item.id}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}

      {data.unmatched.length > 0 && (
        <Section title="PR lines with no matching order" tone="blue" count={data.unmatched.length}
          hint="These families are on a PR but not linked to any order. Link them so receiving lands the stone on the right job — or disregard.">
          {data.unmatched.map(({ item, pr }) => {
            const cands = candidatesFor(item.family_name)
            return (
              <div key={item.id} className="irx-row irx-row-tall">
                <span className="irx-fam-plain">{item.family_name}</span>
                <span className="irx-meta">{lineLabel(item)} · on {pr?.po_number || 'PR'}</span>
                <span className="irx-actions">
                  {cands.map(c => (
                    <button key={c.id} type="button" className="irx-btn irx-btn-cand" disabled={!!busyKey}
                      title={`Link this line to ${famOfRow(c)} (${c.order_number})`}
                      onClick={() => linkItem(item, c)}>
                      → {famOfRow(c)} · {c.order_number}
                    </button>
                  ))}
                  <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => { setLinkFor(linkFor === item.id ? null : item.id); setLinkQ('') }}>
                    {linkFor === item.id ? 'Close search' : 'Search orders…'}
                  </button>
                  <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(item.id, 'unmatched', `d:${item.id}`)}>Disregard</button>
                </span>
                {linkFor === item.id && (
                  <div className="irx-linkbox">
                    <input className="sb-input" autoFocus placeholder="Search family or order #…" value={linkQ} onChange={e => setLinkQ(e.target.value)} />
                    {linkResults.map(c => (
                      <button key={c.id} type="button" className="irx-linkrow" onClick={() => linkItem(item, c)}>
                        {famOfRow(c)} <span className="irx-meta">{c.order_number} · {c.status}</span>
                      </button>
                    ))}
                    {linkQ.trim() && linkResults.length === 0 && <div className="irx-muted" style={{ padding: '6px 2px' }}>No open orders match.</div>}
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {stockMatches.length > 0 && (
        <Section title="Stock stone on order matches a job that needs one" tone="green" count={stockMatches.length}
          hint="The stone is not here, but a STOCK stone of that size is already on an ordered PR — you may not need to order another.">
          {stockMatches.map(m => (
            <div key={`${m.stockItem.id}:${m.dismissKey}`} className="irx-row">
              <button type="button" className="irx-fam" onClick={() => onOpenOrder?.(m.need.orderId)}>{m.need.family}</button>
              <span className="irx-meta">
                needs {m.need.kind === 'base' ? 'base' : 'stone'} {m.need.size}{m.need.color ? ` · ${m.need.color}` : ''} — stock {m.stockItem.size}
                {m.stockItem.color ? ` · ${m.stockItem.color}` : ''} on {m.pr?.po_number || 'PR'} ({m.strength === 'exact' ? 'exact size' : 'near size'})
              </span>
              <span className="irx-actions">
                <button type="button" className="irx-btn" disabled={!!busyKey} onClick={() => disregard(m.stockItem.id, m.dismissKey, `d:${m.stockItem.id}:${m.dismissKey}`)}>Disregard</button>
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, tone, count, hint, children }) {
  return (
    <div className={`irx-sec irx-sec-${tone}`}>
      <div className="irx-sec-head">{title} <span className="irx-count">{count}</span></div>
      {hint && <div className="irx-hint">{hint}</div>}
      <div className="irx-rows">{children}</div>
    </div>
  )
}

const IRX_CSS = `
  .irx-sub { font-size: 13px; color: var(--sb-text-muted, #6b6256); margin-bottom: 16px; max-width: 760px; line-height: 1.5; }
  .irx-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .irx-banner { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 9px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; }
  .irx-banner-ok { background: #e7f3ea; color: #1f7a3d; }
  .irx-banner-err { background: #fdeced; color: #b3261e; }
  .irx-x { margin-left: auto; background: none; border: none; font-size: 17px; color: inherit; opacity: 0.6; cursor: pointer; }
  .irx-sec { background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-left-width: 5px; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
  .irx-sec-red { border-left-color: #B3261E; }
  .irx-sec-amber { border-left-color: #b8842a; }
  .irx-sec-blue { border-left-color: #2563a8; }
  .irx-sec-green { border-left-color: #1d7a55; }
  .irx-sec-head { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--sb-text, #2a2a2a); }
  .irx-count { background: rgba(0,0,0,0.08); border-radius: 999px; padding: 0 9px; font-size: 12px; }
  .irx-hint { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); margin: 3px 0 8px; }
  .irx-rows { display: flex; flex-direction: column; }
  .irx-row { display: flex; align-items: center; gap: 12px; padding: 8px 2px; border-top: 1px solid var(--sb-border-soft, #f0ece2); flex-wrap: wrap; }
  .irx-row-tall { align-items: flex-start; }
  .irx-row:first-child { border-top: 0; }
  .irx-fam { font: inherit; font-size: 14px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; }
  .irx-fam:hover { color: #9A7209; }
  .irx-fam-plain { font-size: 14px; font-weight: 700; color: #1e2d3d; }
  .irx-meta { font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); flex: 1; min-width: 200px; }
  .irx-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .irx-btn { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--sb-border, #d8d2c4); background: #fff; color: #2a2a27; cursor: pointer; }
  .irx-btn:hover:not(:disabled) { border-color: #9A7209; color: #9A7209; }
  .irx-btn:disabled { opacity: 0.5; cursor: default; }
  .irx-btn-go { border-color: #1f7a3d; background: #1f7a3d; color: #fff; }
  .irx-btn-go:hover:not(:disabled) { background: #16612f; border-color: #16612f; color: #fff; }
  .irx-btn-cand { border-color: #2563a8; color: #2563a8; }
  .irx-linkbox { flex-basis: 100%; margin-top: 6px; border: 1px solid var(--sb-border, #e4e0d4); border-radius: 9px; padding: 8px; }
  .irx-linkrow { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; font-weight: 600; background: none; border: none; border-top: 1px solid var(--sb-border-soft, #f0ece2); padding: 7px 4px; cursor: pointer; }
  .irx-linkrow:hover { background: #faf8f3; }
`
