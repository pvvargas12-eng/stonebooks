// =============================================================================
// Stonebooks — Cemetery Orders tab
// =============================================================================
// List of cemetery door orders. Two SEPARATE columns: production STATUS and
// PAYMENT state (payment is computed live from financial_records — unpaid /
// partial / paid in full). Click a row → resume the wizard (drafts) or open
// the detail view (everything else).
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  getCemeteryOrders,
  getDistinctCemeteryNames,
  getPaidTotalsByCemeteryOrder,
  getCemeteryPricingForOrder,
  getDoorPrice,
  setCemeteryOrderArchived,
  deleteCemeteryOrder,
  fmtUSD,
  fmtRelative,
} from './lib/stonebooksData'
import CemeteryOrderDetail from './CemeteryOrderDetail'

// Production lifecycle pills (neutral / muted — distinct from payment).
const CO_STATUS = {
  draft:         { label: 'Draft',          color: '#8b8f95' },
  submitted:     { label: 'Submitted',      color: '#b8842a' },
  in_production: { label: 'In production',  color: '#534AB7' },
  completed:     { label: 'Completed',      color: '#2d7a4f' },
  invoiced:      { label: 'Invoiced',       color: '#1D9E75' },
  cancelled:     { label: 'Cancelled',      color: '#b54040' },
  paid:          { label: 'Completed',      color: '#2d7a4f' },  // legacy 'paid' status → show as completed
}
const STATUS_ORDER = ['draft', 'submitted', 'in_production', 'completed', 'invoiced', 'cancelled']
const PAY_PILL = {
  unpaid:  { label: 'Unpaid',       color: '#b54040' },
  partial: { label: 'Partial',      color: '#b8842a' },
  paid:    { label: 'Paid in full', color: '#2d7a4f' },
}
const GRID = '108px minmax(160px,1fr) 56px 104px 118px 150px 96px 132px'

const rowTotal = (o) => {
  if (o.total_amount != null) return Number(o.total_amount)
  const p = getCemeteryPricingForOrder(o)
  return (o.doors || []).reduce((s, d) => s + getDoorPrice(d, p), 0)
}
const payStateOf = (total, paid) => (total > 0 && paid >= total ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'))

export default function CemeteryOrdersTab({ onResumeDraft, onEditOrder, onOpenJob, staffName, initialSelectedId = null, onConsumeInitialSelected }) {
  const [orders, setOrders] = useState([])
  const [paidTotals, setPaidTotals] = useState({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [cemeteryFilter, setCemeteryFilter] = useState('all')
  const [cemeteryNames, setCemeteryNames] = useState([])
  const [selectedId, setSelectedId] = useState(null)   // non-draft → detail view
  const [archiveView, setArchiveView] = useState('active')   // active | archived | all
  const [msg, setMsg] = useState(null)                       // { error, text }

  useEffect(() => { getDistinctCemeteryNames().then(setCemeteryNames) }, [])

  // Consume an externally-routed "open this order" (e.g. from Profit tab → View full job).
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selectedId) {
      setSelectedId(initialSelectedId)
      onConsumeInitialSelected?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      getCemeteryOrders({
        status: statusFilter === 'all' ? undefined : statusFilter,
        cemetery: cemeteryFilter === 'all' ? undefined : cemeteryFilter,
      }),
      getPaidTotalsByCemeteryOrder(),
    ]).then(([rows, paid]) => {
      if (cancelled) return
      setOrders(rows); setPaidTotals(paid || {}); setLoading(false)
    })
    return () => { cancelled = true }
  }, [statusFilter, cemeteryFilter, selectedId])  // reloads when returning from detail

  // Archive view filters client-side on the `archived` flag — keeps the list
  // query from referencing the column (graceful before the one-line migration).
  const rows = useMemo(() => orders.filter(o => {
    if (archiveView === 'all') return true
    if (archiveView === 'archived') return !!o.archived
    return !o.archived
  }), [orders, archiveView])

  if (selectedId) {
    return <CemeteryOrderDetail orderId={selectedId} onBack={() => setSelectedId(null)} onOpenJob={onOpenJob} onResumeDraft={onResumeDraft} onEditOrder={onEditOrder} staffName={staffName} />
  }

  const onRow = (o) => { if (o.status === 'draft') onResumeDraft?.(o.id); else setSelectedId(o.id) }

  // Optimistic local updates (no full reload/flash, matching the Orders tab).
  const handleArchive = async (o) => {
    setMsg(null)
    const r = await setCemeteryOrderArchived(o.id, !o.archived)
    if (!r.ok) { setMsg({ error: true, text: `Could not ${o.archived ? 'restore' : 'archive'} — ${r.error}. (Run the cemetery_orders.archived migration?)` }); return }
    setOrders(prev => prev.map(x => x.id === o.id ? { ...x, archived: !o.archived } : x))
  }
  const handleDelete = async (o) => {
    setMsg(null)
    if (!window.confirm(`Delete cemetery order ${o.order_number || 'draft'} permanently? This cannot be undone.`)) return
    const r = await deleteCemeteryOrder(o.id)
    if (!r.ok) { setMsg({ error: true, text: `Could not delete — ${r.error}. Orders with jobs or financial records can't be deleted; archive instead.` }); return }
    setOrders(prev => prev.filter(x => x.id !== o.id))
  }

  return (
    <div className="sb-page sb-page-wide col">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Workspace</div>
        <h1 className="sb-page-title">Cemetery Orders</h1>
      </div>

      <div className="col-toolbar">
        <label className="col-filter">Status
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{CO_STATUS[s].label}</option>)}
          </select>
        </label>
        <label className="col-filter">Cemetery
          <select value={cemeteryFilter} onChange={e => setCemeteryFilter(e.target.value)}>
            <option value="all">All</option>
            {cemeteryNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="col-filter">Show
          <select value={archiveView} onChange={e => setArchiveView(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {msg && <div className="sb-empty" style={{ color: msg.error ? '#b54040' : '#1D9E75', marginBottom: 12 }}>{msg.text}</div>}

      {loading ? (
        <div className="sb-empty">Loading cemetery orders…</div>
      ) : rows.length === 0 ? (
        <div className="sb-empty">No cemetery orders{statusFilter !== 'all' || cemeteryFilter !== 'all' ? ' match these filters' : ' yet'}. Start one from <strong>New sale → Cemetery order</strong>.</div>
      ) : (
        <div className="col-table">
          <div className="col-row col-head" style={{ gridTemplateColumns: GRID }}>
            <div>Order</div><div>Cemetery</div>
            <div className="col-r">Doors</div><div className="col-r">Total</div>
            <div>Status</div><div>Payment</div><div className="col-r">Updated</div>
            <div className="col-r">Actions</div>
          </div>
          {rows.map(o => {
            const stt = CO_STATUS[o.status] || { label: o.status, color: '#8b8f95' }
            const total = rowTotal(o)
            const paid = Number(paidTotals[o.id] || 0)
            const isDraft = o.status === 'draft'
            const ps = payStateOf(total, paid)
            const pay = PAY_PILL[ps]
            const closed = (o.status === 'completed' || o.status === 'paid') && ps === 'paid'
            return (
              <div key={o.id} role="button" tabIndex={0}
                className={`col-row${closed ? ' col-row-muted' : ''}${o.archived ? ' col-row-archived' : ''}`}
                style={{ gridTemplateColumns: GRID }}
                onClick={() => onRow(o)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(o) } }}>
                <div className="sb-mono col-ordnum">{o.order_number || <span className="col-muted">draft</span>}</div>
                <div className="col-cem">{o.cemetery_name}</div>
                <div className="col-r">{(o.doors || []).length}</div>
                <div className="col-r sb-mono">{fmtUSD(total)}</div>
                <div><span className="col-pill col-pill-status" style={{ '--pill-color': stt.color }}>{stt.label}</span></div>
                <div>
                  {isDraft || total <= 0
                    ? <span className="col-muted">—</span>
                    : <span className="col-pill col-pill-pay" style={{ '--pill-color': pay.color }}>{pay.label}{ps === 'partial' ? ` · ${fmtUSD(Math.max(0, total - paid))} due` : ''}</span>}
                </div>
                <div className="col-r col-muted">{fmtRelative(o.updated_at)}</div>
                <div className="col-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="col-act" onClick={() => handleArchive(o)}>{o.archived ? 'Restore' : 'Archive'}</button>
                  <button type="button" className="col-act col-act-del" onClick={() => handleDelete(o)}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles = `
  .col-toolbar{ display:flex; gap:16px; margin:18px 0 16px; flex-wrap:wrap; }
  .col-filter{ display:inline-flex; align-items:center; gap:8px; font-size:12px; color:var(--sb-text-muted); }
  .col-filter select{ font:inherit; font-size:13px; padding:7px 10px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-surface); color:var(--sb-text); }
  .col-table{ display:flex; flex-direction:column; gap:6px; }
  .col-row{ display:grid; align-items:center; gap:14px; width:100%; text-align:left; box-sizing:border-box;
    background:var(--sb-surface); border:.5px solid var(--sb-border); border-radius:8px; padding:12px 16px; font:inherit; font-size:13px; color:var(--sb-text); cursor:pointer; }
  .col-row:hover{ background:var(--sb-surface-muted); }
  .col-head{ background:transparent; border:none; padding:0 16px; cursor:default; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--sb-text-muted); }
  .col-head:hover{ background:transparent; }
  .col-row-muted{ opacity:.6; }
  .col-row-archived{ opacity:.55; background:#faf8f4; }
  .col-actions{ display:flex; gap:6px; justify-content:flex-end; }
  .col-act{ font:inherit; font-size:11.5px; padding:4px 10px; border-radius:6px; border:.5px solid var(--sb-border); background:var(--sb-surface); color:var(--sb-text-muted); cursor:pointer; }
  .col-act:hover{ color:var(--sb-text); border-color:#9A7209; }
  .col-act-del{ color:#b54040; }
  .col-act-del:hover{ color:#fff; background:#b54040; border-color:#b54040; }
  .col-r{ text-align:right; font-variant-numeric:tabular-nums; }
  .col-ordnum{ font-size:12px; }
  .col-cem{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .col-muted{ color:var(--sb-text-muted); }
  .col-pill{ display:inline-block; font-size:11px; font-weight:500; border-radius:999px; padding:2px 9px; white-space:nowrap; }
  .col-pill-status{ background:transparent; border:.5px solid var(--pill-color); color:var(--pill-color); }
  .col-pill-pay{ background:var(--pill-color); color:#fff; }
`
if (typeof document !== 'undefined' && !document.getElementById('col-styles')) {
  const tag = document.createElement('style'); tag.id = 'col-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
