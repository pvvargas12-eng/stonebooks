// =============================================================================
// InventorySmartMatches — read-only: open orders' stone needs matched against the
// yard. "You already have this — don't order it." NO writes, NO mutations.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { rowToOrder } from '../SalesMode'
import { getActiveStoneOrders, getInventoryStock } from '../lib/stonebooksData'
import { resolveStoneNeeds, matchNeedsToStock } from '../lib/inventoryMatch'

const titleCase = (s) => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

function familyOf(row) {
  if (row.primary_lastname && String(row.primary_lastname).trim()) return String(row.primary_lastname).trim()
  if (Array.isArray(row.deceased)) {
    const d = row.deceased.find(x => x && !x.isReserved && (x.lastName || x.firstName))
    if (d) return [d.lastName, d.firstName].filter(Boolean).join(', ')
  }
  return row.order_number || 'Order'
}

export default function InventorySmartMatches() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [results, setResults] = useState([])
  const [counts, setCounts] = useState({ orders: 0, stock: 0 })

  const load = useCallback(async () => {
    try {
      const [ordRes, stockRes] = await Promise.all([getActiveStoneOrders(), getInventoryStock()])
      const stock = stockRes.rows || []
      const orders = (ordRes.rows || []).map(r => {
        const o = rowToOrder(r, null, null)
        o.family = familyOf(r)
        return o
      })
      const needs = resolveStoneNeeds(orders)
      setResults(matchNeedsToStock(needs, stock))
      setCounts({ orders: orders.length, stock: stock.length })
      // Surface a load error only if BOTH sources failed (one empty is fine).
      setErr((!ordRes.ok && !stockRes.ok) ? (ordRes.error || stockRes.error) : null)
    } catch (e) {
      setErr(String(e?.message || e))
      setResults([])
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    const exact = [], near = [], none = []
    for (const r of results) {
      if (r.best?.strength === 'exact') exact.push(r)
      else if (r.best?.strength === 'near') near.push(r)
      else none.push(r)
    }
    return { exact, near, none }
  }, [results])

  if (loading) return <div className="sb-empty">Matching open orders against the yard…</div>
  if (err) return (
    <div className="sb-empty">
      Couldn’t run Smart Matches.<br /><span className="ism-muted">{err}</span>
    </div>
  )
  if (results.length === 0) return (
    <div className="sb-empty">
      No open orders need a stone right now.<br />
      <span className="ism-muted">Scanned {counts.orders} active order(s) against {counts.stock} yard item(s).</span>
    </div>
  )

  return (
    <div className="ism">
      <style>{ISM_CSS}</style>
      <div className="ism-summary">
        <span><strong>{groups.exact.length}</strong> exact</span>
        <span><strong>{groups.near.length}</strong> near</span>
        <span><strong>{groups.none.length}</strong> no match</span>
        <span className="ism-summary-meta">{counts.orders} open orders · {counts.stock} yard items</span>
      </div>

      <Group title="Exact matches" tone="exact" rows={groups.exact} hint="Already in the yard — don’t order." />
      <Group title="Near matches" tone="near" rows={groups.near} hint="Close — check the difference before ordering." />
      <Group title="No match in the yard" tone="none" rows={groups.none} hint="Nothing comparable on hand." />
    </div>
  )
}

function Group({ title, tone, rows, hint }) {
  if (!rows.length) return null
  return (
    <div className="ism-group">
      <div className={`ism-group-head ism-group-${tone}`}>
        <span className="ism-group-title">{title}</span>
        <span className="ism-group-count">{rows.length}</span>
        <span className="ism-group-hint">{hint}</span>
      </div>
      <div className="ism-cards">
        {rows.map(r => <MatchCard key={r.need.key} r={r} tone={tone} />)}
      </div>
    </div>
  )
}

function MatchCard({ r, tone }) {
  const { need, best, candidateCount } = r
  return (
    <div className={`ism-card ism-card-${tone}`}>
      <div className="ism-card-top">
        <span className="ism-family">{need.family}</span>
        {need.orderNumber && <span className="ism-ordnum">{need.orderNumber}</span>}
        <span className="ism-kind">{need.kind === 'base' ? 'Base' : titleCase(need.itemType)}</span>
      </div>

      <div className="ism-need">
        <span className="ism-label">Needs</span>
        <span className="ism-spec">{need.spec || '—'}</span>
      </div>

      {best ? (
        <div className="ism-found">
          <span className="ism-label">Found</span>
          <span className="ism-found-body">
            <span className="ism-found-spec">
              {[need.itemType && titleCase(best.stock.item_type), best.stock.color, best.stock.size, best.stock.top, best.stock.sides].filter(Boolean).join(' · ')}
            </span>
            <span className="ism-found-loc">📍 {best.stock.location || 'location not set'}{(best.stock.quantity || 1) > 1 ? ` · qty ${best.stock.quantity}` : ''}</span>
            {candidateCount > 1 && <span className="ism-more">+{candidateCount - 1} more in yard</span>}
          </span>
        </div>
      ) : (
        <div className="ism-found ism-found-none">Nothing comparable in the yard.</div>
      )}

      {best && best.why.length > 0 && (
        <div className="ism-why">{best.why.join(' · ')}</div>
      )}

      <div className="ism-actions">
        <button
          type="button"
          className="ism-btn"
          disabled
          title="Allocation coming in the next phase"
        >
          {best ? 'Allocate to this order' : 'Add to order list'}
        </button>
        <span className="ism-soon">soon</span>
      </div>
    </div>
  )
}

const ISM_CSS = `
  .ism-muted { color: var(--sb-text-muted, #8a7f6c); font-size: 13px; }
  .ism-summary { display: flex; gap: 18px; align-items: center; font-size: 14px; color: var(--sb-text, #2a2a2a); margin-bottom: 18px; flex-wrap: wrap; }
  .ism-summary strong { font-size: 18px; font-variant-numeric: tabular-nums; }
  .ism-summary-meta { margin-left: auto; font-size: 12px; color: var(--sb-text-muted, #8a7f6c); }

  .ism-group { margin-bottom: 22px; }
  .ism-group-head { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 8px; margin-bottom: 12px; }
  .ism-group-exact { background: #e7f3ea; }
  .ism-group-near  { background: #fbf1df; }
  .ism-group-none  { background: #f2efe9; }
  .ism-group-title { font-size: 13px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ism-group-count { font-size: 12px; font-weight: 700; background: rgba(0,0,0,0.08); border-radius: 999px; padding: 1px 9px; }
  .ism-group-hint { font-size: 12px; color: var(--sb-text-muted, #6b6256); margin-left: 4px; }

  .ism-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
  .ism-card { background: var(--sb-surface, #fff); border: 1px solid var(--sb-border, #e4e0d4); border-radius: 12px; padding: 14px 16px; border-left-width: 4px; }
  .ism-card-exact { border-left-color: #1f7a3d; }
  .ism-card-near  { border-left-color: #c9962a; }
  .ism-card-none  { border-left-color: #b8b2a4; }
  .ism-card-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; }
  .ism-family { font-size: 15px; font-weight: 700; color: var(--sb-text, #2a2a2a); }
  .ism-ordnum { font-size: 12px; color: var(--sb-text-muted, #8a7f6c); font-variant-numeric: tabular-nums; }
  .ism-kind { margin-left: auto; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #6b5d3a; background: #f4efe4; padding: 2px 8px; border-radius: 999px; }

  .ism-need, .ism-found { display: flex; gap: 8px; align-items: baseline; margin-bottom: 7px; }
  .ism-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sb-text-muted, #9a8f78); flex: 0 0 42px; }
  .ism-spec { font-size: 13px; color: var(--sb-text, #2a2a2a); }
  .ism-found-body { display: flex; flex-direction: column; gap: 2px; }
  .ism-found-spec { font-size: 13px; font-weight: 600; color: var(--sb-text, #2a2a2a); }
  .ism-found-loc { font-size: 12px; color: #6b5d3a; }
  .ism-more { font-size: 11px; color: var(--sb-text-muted, #8a7f6c); }
  .ism-found-none { font-size: 12.5px; color: var(--sb-text-muted, #8a7f6c); font-style: italic; }
  .ism-why { font-size: 12px; color: #9A7209; background: #fbf1df; border-radius: 6px; padding: 4px 9px; margin: 2px 0 8px; }

  .ism-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .ism-btn { font: inherit; font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--sb-border, #d8d2c4); background: var(--sb-surface-muted, #faf8f3); color: #8a8276; cursor: not-allowed; }
  .ism-soon { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #b3a890; }
`
