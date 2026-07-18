// =============================================================================
// OrdersScreen — look anything up graveside (search family / cemetery / order#)
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { rowBalanceDue, fmtUSD, customerName } from '../lib/stonebooksData'
import { isLeadRaw } from './fieldShared'

// FIELD-2: showMoney gates the balance block — the crew build passes false
// (LEAD pill stays; it carries no amount).
export default function OrdersScreen({ onOpenJob, showMoney = true }) {
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')

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
              <div className="fl-fam">{fam}{isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}</div>
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
