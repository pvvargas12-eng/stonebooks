// =============================================================================
// StonePositionList — every open stone order, DIE + BASE position (2026-08-03)
// =============================================================================
// Paul: "I NEED TO SEE A LIST OF EVERY ORDER WITH A DIE AND WITH A BASE HERE
// ... WE KEEP ORDERING CAUSE WE JUST DONT KNOW." One list, one verdict per
// piece, best evidence wins:
//   IN YARD   — a yard row is linked to this order (or exact-name allocated)
//   RECEIVED  — a stone-PR line for this order came in
//   ORDERED   — a stone-PR line exists / the order's stone milestone says so
//   NOT ORDERED — nothing anywhere (red — the only ones to buy)
// Yard rows verified on the field count wear the date they were last seen.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { properName, customerName } from '../lib/stonebooksData'
import { loadStonePositionData, stoneVerdict, verdictChipText } from '../lib/stonePosition'

// RESET-TAG-1 (2026-10-19): the verdict logic lives in lib/stonePosition.js
// now — the phone's Find box shows the same DIE / BASE chips. IN YARD chips
// carry the painted tag number + zone/crate. Archived (pre-reset) rows never
// count (getInventoryStock excludes them).

export default function StonePositionList({ onOpenOrder }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await loadStonePositionData()
      setData(d)
      setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the stone position.') }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    if (!data) return null
    return data.stoneOrders.map(o => ({
      order: o,
      die: stoneVerdict(o, 'die', data),
      base: stoneVerdict(o, 'base', data),
    }))
  }, [data])

  const filtered = useMemo(() => {
    if (!rows) return null
    let l = rows
    if (onlyMissing) l = l.filter(r => r.die.code === 'none' || r.base.code === 'none')
    const needle = q.trim().toLowerCase()
    if (needle) {
      l = l.filter(r => [r.order.primary_lastname, customerName(r.order.customer), r.order.order_number, r.order.cemetery?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(needle))
    }
    // Reds first (the ones to buy), then family.
    const sev = (r) => (r.die.code === 'none' ? 2 : 0) + (r.base.code === 'none' ? 1 : 0)
    return [...l].sort((a, b) => (sev(b) - sev(a)) || String(a.order.primary_lastname || '').localeCompare(String(b.order.primary_lastname || '')))
  }, [rows, q, onlyMissing])

  const counts = useMemo(() => {
    if (!rows) return null
    const c = { bothHere: 0, dieMissing: 0, baseMissing: 0, total: rows.length }
    for (const r of rows) {
      const dieOk = r.die.code !== 'none', baseOk = r.base.code !== 'none'
      if (dieOk && baseOk) c.bothHere++
      if (!dieOk) c.dieMissing++
      if (!baseOk) c.baseMissing++
    }
    return c
  }, [rows])

  if (err) return <div className="spl"><style>{CSS}</style><div className="spl-empty">{err}</div></div>
  if (!filtered || !counts) return <div className="spl"><style>{CSS}</style><div className="spl-empty">Working out every order's stone position…</div></div>

  return (
    <div className="spl">
      <style>{CSS}</style>
      <div className="spl-head">
        <div className="spl-sub">
          Every open stone order, die and base each answered from the yard links, the stone PRs, and the order status —
          red means NOTHING says it exists, and those are the only ones to buy. Link the yard in Reconcile and verify it
          on the field count to keep this honest.
        </div>
        <div className="spl-kpis">
          <span className="spl-kpi spl-kpi-good">{counts.bothHere} covered</span>
          <span className="spl-kpi spl-kpi-red">{counts.dieMissing} dies not ordered</span>
          <span className="spl-kpi spl-kpi-red">{counts.baseMissing} bases not ordered</span>
          <span className="spl-kpi">{counts.total} orders</span>
        </div>
      </div>
      <div className="spl-tools">
        <input type="search" className="spl-search" placeholder="Search family, order #, cemetery…"
          value={q} onChange={e => setQ(e.target.value)} />
        <label className="spl-check"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> only missing pieces</label>
        <button type="button" className="spl-btn" onClick={load}>Refresh</button>
      </div>
      <div className="spl-rows">
        <div className="spl-row spl-rowhead">
          <div>Family</div><div>Order</div><div>Cemetery</div><div>Die</div><div>Base</div>
        </div>
        {filtered.map(({ order: o, die, base }) => (
          <div key={o.id} className="spl-row">
            <button type="button" className="spl-fam" onClick={() => onOpenOrder?.(o.id)}>
              {properName(o.primary_lastname || customerName(o.customer) || '—')}
            </button>
            <span className="spl-mono">{o.order_number || 'DRAFT'}</span>
            <span className="spl-cem">{o.cemetery?.name || '—'}</span>
            <PieceChip v={die} />
            <PieceChip v={base} />
          </div>
        ))}
        {filtered.length === 0 && <div className="spl-empty">Nothing matches.</div>}
      </div>
    </div>
  )
}

function PieceChip({ v }) {
  const cls = v.code === 'yard' ? 'spl-chip-yard' : v.code === 'received' ? 'spl-chip-good' : v.code === 'ordered' ? 'spl-chip-info' : 'spl-chip-red'
  return (
    <span>
      <span className={`spl-chip ${cls}`}>{verdictChipText(v)}</span>
      {v.sub && <span className="spl-chipsub"> {v.sub}</span>}
    </span>
  )
}

const CSS = `
  .spl { padding: 4px 0 40px; }
  .spl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 10px; }
  .spl-sub { font-size: 12.5px; color: #8a8472; max-width: 620px; line-height: 1.5; }
  .spl-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
  .spl-kpi { font-size: 12px; font-weight: 700; border: 0.5px solid #DCD6C8; border-radius: 999px; padding: 4px 12px; color: #55503F; background: #fff; }
  .spl-kpi-good { color: #1d7a55; border-color: rgba(29,122,85,0.4); }
  .spl-kpi-red { color: #B3261E; border-color: rgba(179,38,30,0.4); }
  .spl-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
  .spl-search { font: inherit; font-size: 13px; padding: 8px 12px; border: 0.5px solid #DCD6C8; border-radius: 9px; min-width: 260px; background: #fff; }
  .spl-check { font-size: 12.5px; font-weight: 600; color: #55503F; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .spl-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 7px 13px; border-radius: 8px; border: 0.5px solid #DCD6C8; background: #fff; cursor: pointer; }
  .spl-btn:hover { border-color: #9A7209; color: #9A7209; }
  .spl-rows { background: #fff; border: 0.5px solid #E6E1D4; border-radius: 12px; padding: 6px 14px; }
  .spl-row { display: grid; grid-template-columns: minmax(140px, 1.2fr) 110px minmax(140px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr); gap: 12px; align-items: center; padding: 8px 0; border-top: 0.5px solid #F3F0E8; }
  .spl-row:first-child { border-top: none; }
  .spl-rowhead { font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #8a8472; }
  .spl-fam { font: inherit; font-size: 13.5px; font-weight: 700; color: #1e2d3d; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
  .spl-fam:hover { color: #9A7209; }
  .spl-mono { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #55503F; }
  .spl-cem { font-size: 12.5px; color: #55503F; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spl-chip { display: inline-block; max-width: 100%; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; border-radius: 999px; padding: 3px 10px; white-space: normal; overflow-wrap: anywhere; }
  .spl-chip-yard { color: #14775A; background: rgba(29,158,117,0.13); border: 0.5px solid rgba(29,158,117,0.35); }
  .spl-chip-good { color: #1d7a55; background: rgba(29,122,85,0.12); }
  .spl-chip-info { color: #185F8F; background: rgba(29,111,168,0.12); }
  .spl-chip-red { color: #fff; background: #B3261E; }
  .spl-chipsub { font-size: 10.5px; color: #8a8472; }
  .spl-empty { font-size: 13px; color: #8a8472; padding: 14px 4px; }
`
