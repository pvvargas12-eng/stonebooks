// =============================================================================
// Stonebooks — Workflow Hubs (operational queues dashboard)
// =============================================================================
// A board of queue cards: each queue is a named view over ACTIVE orders, with a
// live count. Clicking a card opens the Orders Triage Workbench pre-filtered to
// that queue (reusing its rows + bulk tools — no parallel list). READ-ONLY: this
// surface never writes. Counts come from the shared classifyOrderQueues, so the
// dashboard and the list can never disagree.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  listAllOrders, getJobs, computeOrderPressure, rowBalanceDue, fmtUSD,
  classifyOrderQueues, PRODUCTION_QUEUES, OVERLAY_QUEUES,
} from './lib/stonebooksData'

export default function QueuesTab({ onOpenQueue }) {
  const [orders, setOrders] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    Promise.all([
      listAllOrders({ archived: false, limit: 2000 }),   // active-only
      getJobs({ includeClosed: true, limit: 2000 }),
    ])
      .then(([os, js]) => { if (!cancelled) { setOrders(os || []); setJobs(js || []); setLoading(false) } })
      .catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load queues'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const { prodCounts, overlayCounts, balancesTotal, activeNewStone, activeTotal } = useMemo(() => {
    const jobByOrderId = new Map()
    for (const j of jobs) if (j.order_id && !jobByOrderId.has(j.order_id)) jobByOrderId.set(j.order_id, j)
    const prod = Object.fromEntries(PRODUCTION_QUEUES.map(q => [q.code, 0]))
    const overlay = Object.fromEntries(OVERLAY_QUEUES.map(q => [q.code, 0]))
    let balances = 0, newStone = 0, total = 0
    for (const o of orders) {
      if (o.status === 'closed' || o.status === 'cancelled') continue
      total += 1
      const job = jobByOrderId.get(o.id) || null
      if (job?.job_type === 'new_stone') newStone += 1
      const pressure = computeOrderPressure(o, job, job?.milestones)
      const c = classifyOrderQueues(o, job, pressure)
      if (c.productionQueue) prod[c.productionQueue] += 1
      for (const ov of c.overlays) if (overlay[ov] != null) overlay[ov] += 1
      if (c.overlays.includes('balances_due')) balances += rowBalanceDue(o)
    }
    return { prodCounts: prod, overlayCounts: overlay, balancesTotal: balances, activeNewStone: newStone, activeTotal: total }
  }, [orders, jobs])

  return (
    <div className="sb-crm-page">
      <style>{QH_CSS}</style>
      <div className="sb-crm-container">
        <header className="sb-crm-head">
          <div>
            <h1 className="sb-crm-head-title">Workflow Hubs</h1>
            <div className="sb-crm-head-count">
              {loading ? '—' : <><strong>{activeTotal}</strong> active orders · <strong>{activeNewStone}</strong> in the new-stone pipeline</>}
            </div>
          </div>
        </header>

        {err && <div className="sb-crm-error">{err}</div>}

        <div className="sb-qh-group-label">Production pipeline</div>
        <div className="sb-qh-board">
          {PRODUCTION_QUEUES.map(q => (
            <QueueCard key={q.code} label={q.label} count={prodCounts[q.code]} loading={loading} onClick={() => onOpenQueue?.(q.code)} />
          ))}
        </div>

        <div className="sb-qh-group-label">Needs attention</div>
        <div className="sb-qh-board">
          <QueueCard label="Balances due" count={overlayCounts.balances_due} sub={loading ? null : fmtUSD(balancesTotal)}
            tone="amber" loading={loading} onClick={() => onOpenQueue?.('balances_due')} />
          <QueueCard label="Blocked" count={overlayCounts.blocked} tone="red" loading={loading} onClick={() => onOpenQueue?.('blocked')} />
        </div>

        <p className="sb-qh-note">
          Queues count active (non-archived) orders. Production queues are new-stone jobs, each shown once in its
          furthest-along stage; attention overlays are cross-cutting. Clicking a queue opens the Orders list filtered
          to it, with the bulk tools ready.
        </p>
      </div>
    </div>
  )
}

function QueueCard({ label, count, sub, tone, loading, onClick }) {
  const zero = !loading && count === 0
  return (
    <button type="button" className={`sb-qh-card${zero ? ' sb-qh-card-zero' : ''}`} onClick={onClick}>
      <span className="sb-qh-card-label">{label}</span>
      <span className={`sb-qh-card-count${tone ? ` sb-qh-count-${tone}` : ''}`}>{loading ? '—' : count}</span>
      {sub && <span className="sb-qh-card-sub">{sub}</span>}
      {zero && <span className="sb-qh-card-empty">nothing here</span>}
    </button>
  )
}

const QH_CSS = `
  .sb-qh-group-label { font-family: var(--font-d, 'Playfair Display'), Georgia, serif; font-size: 15px; font-weight: 600; color: #1e2d3d; margin: 22px 0 12px; }
  .sb-qh-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
  .sb-qh-card { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; background: #fff; border: 0.5px solid #e4e2dd; border-radius: 12px; padding: 16px 18px; cursor: pointer; min-height: 92px; transition: border-color 0.12s, box-shadow 0.12s; }
  .sb-qh-card:hover { border-color: #9A7209; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
  .sb-qh-card-label { font-size: 13px; color: #555; font-weight: 600; }
  .sb-qh-card-count { font-size: 30px; font-weight: 700; color: #1e2d3d; line-height: 1.1; font-variant-numeric: tabular-nums; margin-top: auto; }
  .sb-qh-count-amber { color: #B8842A; }
  .sb-qh-count-red { color: #B54040; }
  .sb-qh-card-sub { font-size: 12px; color: #8a8a85; font-variant-numeric: tabular-nums; }
  .sb-qh-card-empty { font-size: 11px; color: #b0b0a8; }
  .sb-qh-card-zero { opacity: 0.55; }
  .sb-qh-card-zero:hover { opacity: 1; }
  .sb-qh-note { font-size: 12.5px; color: #8a8a85; line-height: 1.5; max-width: 720px; margin-top: 20px; }
`
