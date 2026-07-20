// =============================================================================
// LeadsScreen — the chase list (FIELD-3, owner build)
// =============================================================================
// Every open order with no real money down (isLeadRaw), stalest first — the
// lead that has sat quiet the longest is the one on top. Read-only surface:
// the only actions are CALL (tel:) and the drill into the job. Same paged
// open-orders fetch as TodayScreen (draft/scoping/quoted/contracted stay in;
// only archived/cancelled/closed are excluded — isLeadRaw drops terminals
// anyway, the query just keeps the page count honest).
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { familyNameOf, isLeadRaw, todayISO } from './fieldShared'

async function fetchLeadOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customer:customers(*), cemetery:cemeteries(name)')
      .neq('status', 'archived')
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .range(start, start + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// The customers table carries phone_primary / phone_alt (there is no bare
// `phone` column — see createCustomer/_CUSTOMER_EDITABLE in stonebooksData).
const phoneDigitsOf = (customer) => {
  const raw = customer?.phone_primary || customer?.phone_alt || customer?.phone || ''
  return String(raw).replace(/\D/g, '')
}

export default function LeadsScreen({ who, undo, onOpenJob, onBack }) {
  const [orders, setOrders] = useState(null)   // null = loading
  const [err, setErr] = useState(null)
  const [today, setToday] = useState(() => todayISO())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchLeadOrders()
        if (cancelled) return
        setOrders(rows)
        setToday(todayISO())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the leads.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Leads only, stalest first — plus the quiet-days read, day-granular off the
  // fetch-time date stamp (noon keeps "N days" honest against timestamps taken
  // at any hour; no impure clock in render).
  const leads = useMemo(() => {
    if (!orders) return []
    const nowMs = new Date(today + 'T12:00:00').getTime()
    const stamp = (o) => o.updated_at || o.created_at || null
    return orders
      .filter(isLeadRaw)
      .map(o => {
        const iso = stamp(o)
        const ms = iso ? new Date(iso).getTime() : NaN
        const quietDays = isNaN(ms) ? null : Math.max(0, Math.floor((nowMs - ms) / 86400000))
        return { o, quietDays, digits: phoneDigitsOf(o.customer) }
      })
      .sort((a, z) => String(stamp(a.o) || '').localeCompare(String(stamp(z.o) || '')))
  }, [orders, today])

  const call = (e, digits) => {
    e.stopPropagation()
    window.location.href = 'tel:' + digits
  }

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; Menu</button>
      )}
      <div className="fl-greet">Leads</div>
      <div className="fl-greet-sub" style={{ marginBottom: 14 }}>No deposit yet &#8212; the chase list</div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && orders === null && <div className="fl-empty">Loading leads&#8230;</div>}
      {!err && orders !== null && leads.length === 0 && (
        <div className="fl-empty">No leads &#8212; every open order has money down.</div>
      )}

      {leads.map(({ o, quietDays, digits }) => (
        <div key={o.id} className="fl-row fl-row-flex"
          onClick={() => onOpenJob({ orderId: o.id, jobId: null }, 'menu')}>
          <div className="fl-row-main">
            <div className="fl-fam">
              {familyNameOf(o)}
              <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>
            </div>
            <div className="fl-spec">
              {[o.order_number || 'DRAFT', o.cemetery?.name].filter(Boolean).join(' · ')}
            </div>
            {quietDays !== null && (
              <div className="fl-cem">
                Quiet {quietDays} day{quietDays === 1 ? '' : 's'}
                {quietDays >= 14 && (
                  <span className="fl-chip fl-c-bad" style={{ marginLeft: 8, verticalAlign: 'middle' }}>QUIET 14D+</span>
                )}
              </div>
            )}
          </div>
          {digits && (
            <button type="button" className="fl-verb" onClick={(e) => call(e, digits)}>CALL</button>
          )}
          <span className="fl-chev">&#8250;</span>
        </div>
      ))}
    </div>
  )
}
