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
import {
  listOpenOrdersLight, listJobOrderPairs, getInventoryStock,
  properName, customerName, fmtDate,
} from '../lib/stonebooksData'
import { supabase } from '../lib/supabase'

const STONE_SVC = new Set(['NEW_STONE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'])
// Yard item types that fill the DIE slot (the carved piece) vs the BASE slot.
const DIE_TYPES = new Set(['die', 'slant', 'grass', 'hickey', 'marker', 'flat', 'upright'])
const isDieType = (t) => DIE_TYPES.has(String(t || '').toLowerCase())
const isBaseType = (t) => String(t || '').toLowerCase() === 'base'

const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3)

export default function StonePositionList({ onOpenOrder }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [orders, pairs, stockRes, prLines] = await Promise.all([
        listOpenOrdersLight(),
        listJobOrderPairs(),
        getInventoryStock().then(r => (Array.isArray(r) ? r : (r?.rows || []))),
        supabase.from('bulk_order_items')
          .select('order_id, item_type, quantity, received_qty, bulk_order:bulk_orders(status, kind)')
          .not('order_id', 'is', null)
          .then(({ data: rows, error }) => { if (error) throw new Error(error.message); return rows || [] }),
      ])
      const stoneOrders = (orders || []).filter(o => (o.service_types || []).some(s => STONE_SVC.has(String(s).toUpperCase())))
      // Stone milestones for these orders' jobs, chunked.
      const jobByOrder = new Map((pairs || []).map(p => [p.order_id, p.id]))
      const jobIds = stoneOrders.map(o => jobByOrder.get(o.id)).filter(Boolean)
      const msByJob = new Map()
      for (let i = 0; i < jobIds.length; i += 150) {
        const { data: ms, error } = await supabase.from('job_milestones')
          .select('job_id, milestone_key, status')
          .in('job_id', jobIds.slice(i, i + 150))
          .in('milestone_key', ['stone_in_stock', 'stone_ordered', 'stone_needs_pickup', 'stone_received'])
        if (error) continue
        for (const m of (ms || [])) {
          if (!msByJob.has(m.job_id)) msByJob.set(m.job_id, {})
          msByJob.get(m.job_id)[m.milestone_key] = m.status
        }
      }
      setData({ stoneOrders, jobByOrder, msByJob, stock: stockRes, prLines })
      setErr(null)
    } catch (e) { setErr(e?.message || 'Could not load the stone position.') }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    if (!data) return null
    const { stoneOrders, jobByOrder, msByJob, stock, prLines } = data
    const allocStock = stock.filter(r => r.status === 'allocated')
    const prByOrder = new Map()
    for (const l of prLines) {
      if (l.bulk_order?.status === 'cancelled') continue
      if (!prByOrder.has(l.order_id)) prByOrder.set(l.order_id, [])
      prByOrder.get(l.order_id).push(l)
    }
    const verdictFor = (order, slot) => {
      const slotMatch = slot === 'die' ? isDieType : isBaseType
      // 1 — a yard piece, linked (or allocated under this exact family name).
      const oTokens = new Set([...tokens(order.primary_lastname), ...tokens(order.customer?.last_name)])
      const yard = allocStock.find(r => slotMatch(r.item_type) && (
        r.allocated_order_id === order.id
        || (!r.allocated_order_id && tokens(r.assigned_to).some(t => oTokens.has(t)))
      ))
      if (yard) return { code: 'yard', label: 'IN YARD', sub: yard.verified_at ? `seen ${fmtDate(yard.verified_at)}` : null, linked: !!yard.allocated_order_id }
      // 2 — a stone-PR line for this order, typed for the slot.
      const lines = (prByOrder.get(order.id) || []).filter(l => slotMatch(l.item_type))
      if (lines.some(l => Number(l.received_qty) > 0)) return { code: 'received', label: 'RECEIVED' }
      if (lines.length) return { code: 'ordered', label: 'ORDERED' }
      // 3 — the order's whole-stone milestone ladder (no per-piece detail).
      const ms = msByJob.get(jobByOrder.get(order.id)) || {}
      if (ms.stone_received === 'done' || ms.stone_in_stock === 'done') return { code: 'received', label: 'HERE', sub: 'per the order status' }
      if (ms.stone_ordered === 'done' || ms.stone_needs_pickup === 'done') return { code: 'ordered', label: 'ORDERED', sub: 'per the order status' }
      return { code: 'none', label: 'NOT ORDERED' }
    }
    return stoneOrders.map(o => ({
      order: o,
      die: verdictFor(o, 'die'),
      base: verdictFor(o, 'base'),
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
      <span className={`spl-chip ${cls}`}>{v.label}</span>
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
  .spl-chip { font-size: 10px; font-weight: 800; letter-spacing: 0.05em; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
  .spl-chip-yard { color: #14775A; background: rgba(29,158,117,0.13); border: 0.5px solid rgba(29,158,117,0.35); }
  .spl-chip-good { color: #1d7a55; background: rgba(29,122,85,0.12); }
  .spl-chip-info { color: #185F8F; background: rgba(29,111,168,0.12); }
  .spl-chip-red { color: #fff; background: #B3261E; }
  .spl-chipsub { font-size: 10.5px; color: #8a8472; }
  .spl-empty { font-size: 13px; color: #8a8472; padding: 14px 4px; }
`
