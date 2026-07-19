// =============================================================================
// OrdersScreen — look anything up graveside (search family / cemetery / order#)
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { rowBalanceDue, rowTotalPaid, fmtUSD, customerName } from '../lib/stonebooksData'
import { isOrderRow } from '../lib/leads'
import { isLeadRaw } from './fieldShared'

// FIELD-2: showMoney gates the balance block — the crew build passes false
// (LEAD pill stays; it carries no amount).
// SALES tab: `view` mirrors the desktop Sales views — 'orders' (contracted +
// money down, isOrderRow), 'leads' (the rest), 'all' (everything ever —
// closed/cancelled/archived included, so the fetch widens). null = the
// original active-only unfiltered list (FIND search + inventory unchanged).
export default function OrdersScreen({ onOpenJob, showMoney = true, view = null }) {
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const wantEverything = view === 'all'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let query = supabase
        .from('orders')
        .select('*, customer:customers(*), cemetery:cemeteries(*)')
      if (!wantEverything) {
        query = query
          .neq('status', 'archived')
          .neq('status', 'cancelled')
          .neq('status', 'closed')
          .or('archived.is.null,archived.eq.false')
      }
      const { data, error } = await query
        .order('updated_at', { ascending: false })
        .limit(400)
      if (cancelled) return
      if (error) { setErr(error.message); return }
      setOrders(data || [])
    })()
    return () => { cancelled = true }
  }, [wantEverything])

  const list = useMemo(() => {
    if (!orders) return []
    let pool = orders
    if (view === 'orders') pool = pool.filter(o => isOrderRow(o, rowTotalPaid(o)))
    else if (view === 'leads') pool = pool.filter(o => !isOrderRow(o, rowTotalPaid(o)))
    const needle = q.trim().toLowerCase()
    if (!needle) return pool.slice(0, 60)
    return pool.filter(o => {
      const hay = [
        o.primary_lastname, o.order_number, o.cemetery?.name,
        o.customer?.first_name, o.customer?.last_name,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(needle)
    }).slice(0, 60)
  }, [orders, q, view])

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
        return (
          <button key={o.id} type="button" className="fl-row fl-row-flex"
            onClick={() => onOpenJob({ orderId: o.id, jobId: null })}>
            <div className="fl-row-main">
              <div className="fl-fam">
                {fam}
                {isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}
                {wantEverything && ['closed', 'cancelled', 'archived'].includes(o.status) && (
                  <span className="fl-chip fl-c-neutral" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{o.status.toUpperCase()}</span>
                )}
              </div>
              <div className="fl-spec">{[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}</div>
            </div>
            {showMoney && (
              <div className="fl-inv-qty" style={{ fontSize: 13 }}>
                <small>BALANCE</small>{fmtUSD(bal)}
              </div>
            )}
            <span className="fl-chev">&#8250;</span>
          </button>
        )
      })}
    </div>
  )
}
