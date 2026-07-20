// =============================================================================
// CemOrdersScreen — cemetery door orders from the phone (owner build)
// =============================================================================
// FIELD-3: read-only glance list of cemetery_orders (door work placed by a
// cemetery, separate from family sales). Same row math as the desktop
// CemeteryOrdersTab — total_amount wins, else doors re-priced through the
// pricing snapshot; per-order door progress comes from the spawned
// mausoleum_door jobs (jobs.cemetery_order_id). No drill: cemetery orders have
// no phone detail view, the desktop owns the workflow.
// =============================================================================
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtUSD, getCemeteryPricingForOrder, getDoorPrice } from '../lib/stonebooksData'

// Same lifecycle labels as the desktop CO_STATUS map (legacy 'paid' reads as
// completed there too). Chip tones per spec: in_production info, rest neutral.
const CO_STATUS_LABEL = {
  draft: 'Draft', submitted: 'Submitted', in_production: 'In production',
  completed: 'Completed', invoiced: 'Invoiced', cancelled: 'Cancelled',
  paid: 'Completed',
}
const statusChipCls = (s) => (s === 'in_production' ? 'fl-c-info' : 'fl-c-neutral')

// Desktop rowTotal: stored total wins; otherwise re-price the doors through the
// order's pricing (snapshot or by-name lookup — both sync).
function rowTotal(o) {
  if (o.total_amount != null) return Number(o.total_amount)
  const p = getCemeteryPricingForOrder(o)
  return (o.doors || []).reduce((s, d) => s + getDoorPrice(d, p), 0)
}

export default function CemOrdersScreen({ who, undo, onOpenJob, onBack }) {
  const [rows, setRows] = useState(null)          // null = loading
  const [doorJobs, setDoorJobs] = useState({})    // cemetery_order_id -> { closed, total }
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('cemetery_orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(60)
        if (error) throw new Error(error.message)
        if (cancelled) return
        const live = (data || []).filter(o => !o.archived)
        setRows(live)
        const ids = live.map(o => o.id)
        if (ids.length) {
          const { data: jobs, error: jErr } = await supabase
            .from('jobs')
            .select('id, cemetery_order_id, overall_status')
            .in('cemetery_order_id', ids)
          if (jErr || cancelled) return   // progress lines just stay off
          const map = {}
          for (const j of jobs || []) {
            const m = map[j.cemetery_order_id] || (map[j.cemetery_order_id] = { closed: 0, total: 0 })
            m.total += 1
            if (j.overall_status === 'closed') m.closed += 1
          }
          if (!cancelled) setDoorJobs(map)
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load cemetery orders.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div style={{ margin: '4px 2px 14px' }}>
        <div className="fl-sect-h" style={{ fontSize: 26 }}>Cemetery orders</div>
        <div className="fl-greet-sub">Door work, by order</div>
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && rows === null && <div className="fl-empty">Loading cemetery orders&#8230;</div>}
      {!err && rows !== null && rows.length === 0 && (
        <div className="fl-empty">No cemetery orders yet.</div>
      )}
      {!err && rows !== null && rows.map(o => (
        <CemOrderRow key={o.id} order={o} progress={doorJobs[o.id]} />
      ))}
    </div>
  )
}

function CemOrderRow({ order: o, progress }) {
  const doorCount = Array.isArray(o.doors) ? o.doors.length : 0
  const label = CO_STATUS_LABEL[o.status] || o.status || '—'
  // "N of M doors closed" — M prefers the doors on the order; a legacy order
  // with an empty doors array falls back to its spawned job count.
  const totalDoors = doorCount || progress?.total || 0
  const allClosed = progress && totalDoors > 0 && progress.closed >= totalDoors
  return (
    <div className="fl-row" style={{ cursor: 'default' }}>
      <div className="fl-rowtop">
        <div className="fl-fam" style={{ fontSize: 15.5, minWidth: 0 }}>
          {o.cemetery_name || 'Untitled'}
        </div>
        <span className={`fl-chip ${statusChipCls(o.status)}`} style={{ flexShrink: 0 }}>
          {label.toUpperCase()}
        </span>
      </div>
      <div className="fl-rowtop" style={{ marginTop: 4 }}>
        <div className="fl-spec" style={{ marginTop: 0 }}>
          {o.order_number || 'DRAFT'} &#183; {doorCount} {doorCount === 1 ? 'door' : 'doors'}
        </div>
        <div style={{
          fontFamily: '"JetBrains Mono", Consolas, monospace',
          fontSize: 13, fontWeight: 700, color: '#16150F', flexShrink: 0,
        }}>
          {fmtUSD(rowTotal(o))}
        </div>
      </div>
      {progress && progress.total > 0 && (
        <div className="fl-cem" style={allClosed ? { color: '#14775A' } : undefined}>
          {progress.closed} of {totalDoors} doors closed
        </div>
      )}
    </div>
  )
}
