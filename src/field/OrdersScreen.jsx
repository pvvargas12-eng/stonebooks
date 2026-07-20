// =============================================================================
// OrdersScreen — look anything up graveside (search family / cemetery / order#)
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { rowBalanceDue, fmtUSD, customerName, getJobByOrderId } from '../lib/stonebooksData'
import { isLeadRaw } from './fieldShared'
import StatusSheet from './StatusSheet'

// FIELD-2: showMoney gates the balance block — the crew build passes false
// (LEAD pill stays; it carries no amount).
// FIELD-3: showStatus (owner) adds a per-row STATUS button that opens the
// StatusSheet (design / stone / foundation / blocker chips). The job is
// fetched lazily on open; the row body tap still opens the job as before.
export default function OrdersScreen({ onOpenJob, showMoney = true, showStatus = false, who, undo }) {
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  // { order, job, ready } — ready flips once the lazy job fetch lands.
  const [sheet, setSheet] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customer:customers(*), cemetery:cemeteries(*)')
        .neq('status', 'archived')
        .neq('status', 'cancelled')
        .neq('status', 'closed')
        .or('archived.is.null,archived.eq.false')
        .order('updated_at', { ascending: false })
        .limit(400)
      if (cancelled) return
      if (error) { setErr(error.message); return }
      setOrders(data || [])
    })()
    return () => { cancelled = true }
  }, [])

  const list = useMemo(() => {
    if (!orders) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return orders.slice(0, 60)
    return orders.filter(o => {
      const hay = [
        o.primary_lastname, o.order_number, o.cemetery?.name,
        o.customer?.first_name, o.customer?.last_name,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(needle)
    }).slice(0, 60)
  }, [orders, q])

  // Open the sheet immediately (loading shell), then fetch the order's job —
  // StatusSheet gets the job when one exists, null otherwise. Functional set +
  // id guard so a close-and-reopen during the fetch can't resurrect a sheet.
  const openStatus = (o) => {
    setSheet({ order: o, job: null, ready: false })
    ;(async () => {
      const job = await getJobByOrderId(o.id).catch(() => null)
      setSheet(s => (s && !s.ready && s.order?.id === o.id) ? { ...s, job, ready: true } : s)
    })()
  }

  // After a sheet write: re-pull just that order row so a reopened sheet reads
  // fresh manual_blocker/etc. Failures are swallowed — a stale chip is fine.
  const refreshRow = (orderId) => {
    ;(async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customer:customers(*), cemetery:cemeteries(*)')
        .eq('id', orderId)
        .maybeSingle()
      if (error || !data) return
      setOrders(prev => prev ? prev.map(o => (o.id === orderId ? data : o)) : prev)
    })()
  }

  if (err) return <div className="fl-empty">{err}</div>
  if (orders === null) return <div className="fl-empty">Loading orders…</div>

  return (
    <div>
      <input className="fl-search" type="search" placeholder="Search family, cemetery, order #"
        value={q} onChange={e => setQ(e.target.value)} />
      {list.length === 0 && <div className="fl-empty">No matches.</div>}
      {list.map(o => {
        const fam = (o.primary_lastname || customerName(o.customer) || '—').toUpperCase()
        const bal = rowBalanceDue(o)
        const inner = (
          <>
            <div className="fl-row-main">
              <div className="fl-fam">{fam}{isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}</div>
              <div className="fl-spec">{[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}</div>
            </div>
            {showMoney && (
              <div className="fl-inv-qty" style={{ fontSize: 13 }}>
                <small>BALANCE</small>{fmtUSD(bal)}
              </div>
            )}
            {showStatus && (
              <button type="button" className="fl-verb"
                onClick={e => { e.stopPropagation(); openStatus(o) }}>
                STATUS
              </button>
            )}
            <span className="fl-chev">&#8250;</span>
          </>
        )
        // A button can't nest the STATUS button (invalid HTML) — the status
        // build renders the row as a div with button semantics instead.
        if (!showStatus) return (
          <button key={o.id} type="button" className="fl-row fl-row-flex"
            onClick={() => onOpenJob({ orderId: o.id, jobId: null })}>
            {inner}
          </button>
        )
        return (
          <div key={o.id} role="button" tabIndex={0} className="fl-row fl-row-flex"
            onClick={() => onOpenJob({ orderId: o.id, jobId: null })}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenJob({ orderId: o.id, jobId: null }) } }}>
            {inner}
          </div>
        )
      })}

      {sheet && !sheet.ready && (
        <>
          <div className="fl-sheet-scrim" onClick={() => setSheet(null)} />
          <div className="fl-sheet">
            <div className="fl-sheet-grab" />
            <div className="fl-empty">Loading…</div>
          </div>
        </>
      )}
      {sheet && sheet.ready && (
        <StatusSheet key={sheet.order.id} order={sheet.order} job={sheet.job}
          who={who} undo={undo}
          onClose={() => setSheet(null)}
          onChanged={() => refreshRow(sheet.order.id)} />
      )}
    </div>
  )
}
