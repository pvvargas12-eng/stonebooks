// =============================================================================
// StockSavingsPanel — "Saved by using stock" on Reports › Owner stats
// =============================================================================
// Paul 2026-11-13: "that's also a number I want to see in owner reports, money
// saved by using stock." Every Confirm match on a Stone PR writes a record
// (stock_match_log) with what the line would have cost in the supplier's price
// book. This panel adds those up: this month, this year, since the record
// began, and the stones behind the number. Removed matches are not counted.
// Read-only. `preload` = smoke mounts only.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { fmtUSD, fmtYardTag } from '../lib/stonebooksData'
import { listStockMatches } from '../lib/stockMatches'

export default function StockSavingsPanel({ now, onOpenOrder = null, preload = null }) {
  const [rows, setRows] = useState(preload)
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (preload) return
    let alive = true
    listStockMatches({}).then(l => { if (alive) setRows(l) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [preload])

  const sums = useMemo(() => {
    const list = rows || []
    const m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const y0 = new Date(now.getFullYear(), 0, 1).getTime()
    const add = (acc, l) => { acc.n++; acc.usd += Number(l.saved_amount) || 0; if (l.saved_amount == null) acc.unpriced++; return acc }
    const zero = () => ({ n: 0, usd: 0, unpriced: 0 })
    const month = zero(), year = zero(), ever = zero()
    for (const l of list) {
      const t = new Date(l.matched_at).getTime()
      add(ever, l); if (t >= y0) add(year, l); if (t >= m0) add(month, l)
    }
    return { month, year, ever }
  }, [rows, now])

  if (rows == null) return <div className="ost-panel"><div className="ost-panel-head"><span className="ost-panel-title">Saved by using stock</span></div><div className="ssp-note">Loading…</div></div>
  const shown = all ? rows : rows.slice(0, 8)
  const tile = (label, v) => (
    <div className="ssp-tile">
      <div className="ssp-lab">{label}</div>
      <div className="ssp-big">{fmtUSD(v.usd)}</div>
      <div className="ssp-sub">{v.n} yard stone{v.n === 1 ? '' : 's'} used instead of ordered{v.unpriced ? ` · ${v.unpriced} not priced` : ''}</div>
    </div>
  )
  return (
    <div className="ost-panel">
      <style>{CSS}</style>
      <div className="ost-panel-head"><span className="ost-panel-title">Saved by using stock</span></div>
      <div className="ssp-tiles">
        {tile('This month', sums.month)}{tile(`${now.getFullYear()} so far`, sums.year)}{tile('Since the record began', sums.ever)}
      </div>
      {rows.length === 0 ? (
        <div className="ssp-note">Nothing yet. Each time a yard stone is matched to a line on a Stone PR (Confirm match), the line's price in the supplier's book is counted here.</div>
      ) : (
        <>
          <div className="ssp-list">
            {shown.map(l => (
              <button type="button" key={l.id} className="ssp-row" disabled={!onOpenOrder || !l.order_id} onClick={() => onOpenOrder?.(l.order_id)}>
                <span className="ssp-d">{new Date(l.matched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span className="ssp-num">{l.yard_tag != null ? `#${fmtYardTag(l.yard_tag)}` : 'no number'}</span>
                <span className="ssp-fam">{l.family || 'Order'}<small>{[(l.piece || 'stone').toUpperCase(), l.stone_spec, l.po_number, l.supplier].filter(Boolean).join(' · ')}</small></span>
                <span className="ssp-amt">{l.saved_amount != null ? fmtUSD(Number(l.saved_amount)) : '—'}</span>
              </button>
            ))}
          </div>
          {rows.length > 8 && <button type="button" className="ssp-more" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
          <div className="ssp-note">Saved = the listed price of that size and color in the supplier&apos;s book (Peerless or Kani), the same number the PR shows as Cost. Freight and shaped tops are not in it. A match that was removed is not counted.</div>
        </>
      )}
    </div>
  )
}

const CSS = `
  .ssp-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
  .ssp-tile { border: 1px solid #cfe3d3; background: #f7fbf8; border-radius: 10px; padding: 11px 13px; min-width: 0; }
  .ssp-lab { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #1f5c33; font-weight: 700; }
  .ssp-big { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-size: 22px; font-weight: 700; color: #1f7a3d; margin-top: 3px; overflow-wrap: anywhere; }
  .ssp-sub, .ssp-note { font-size: 12.5px; color: var(--sb-text-muted, #6f685c); line-height: 1.45; overflow-wrap: anywhere; }
  .ssp-note { margin-top: 8px; }
  .ssp-list { display: flex; flex-direction: column; }
  .ssp-row { display: grid; grid-template-columns: 56px 64px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; padding: 7px 0; border: none; border-top: 1px solid #eee9dd; background: none; font: inherit; font-size: 13px; color: inherit; text-align: left; cursor: pointer; width: 100%; min-width: 0; }
  .ssp-row:disabled { cursor: default; }
  .ssp-d { font-size: 11.5px; color: var(--sb-text-muted, #6f685c); white-space: nowrap; }
  .ssp-num { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-weight: 800; white-space: nowrap; }
  .ssp-fam { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .ssp-fam small { display: block; font-weight: 400; font-size: 11.5px; color: var(--sb-text-muted, #6f685c); }
  .ssp-amt { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-weight: 700; color: #1f7a3d; white-space: nowrap; }
  .ssp-more { margin-top: 6px; background: none; border: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: #6b5d3a; cursor: pointer; text-decoration: underline; }
  @media (max-width: 800px) { .ssp-tiles { grid-template-columns: 1fr; } }
`
