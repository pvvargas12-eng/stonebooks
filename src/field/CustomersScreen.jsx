// =============================================================================
// CustomersScreen — look anyone up and reach them in one tap (FIELD-3, owner)
// =============================================================================
// Server-side search (2+ chars, debounced) over the customers table. Tapping a
// result expands it inline: CALL / TEXT / EMAIL verbs (only the channels that
// exist on the row) plus that customer's orders, each a drill into the job.
// NOTE the real phone columns are phone_primary / phone_alt — there is no bare
// `phone` column (see _CUSTOMER_EDITABLE / createCustomer in stonebooksData;
// SalesMode's searchCustomers filters the same pair).
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { customerName, statusInfo } from '../lib/stonebooksData'
import { familyNameOf } from './fieldShared'

const STATUS_CHIP = {
  draft: 'fl-c-neutral', scoping: 'fl-c-neutral', quoted: 'fl-c-neutral',
  contracted: 'fl-c-good', in_production: 'fl-c-info', installed: 'fl-c-good',
  paid_in_full: 'fl-c-good', closed: 'fl-c-neutral', cancelled: 'fl-c-bad',
  archived: 'fl-c-neutral',
}

const digitsOf = (raw) => String(raw || '').replace(/\D/g, '')

// PostgREST's .or() splits its argument on commas/parens — strip them from the
// needle so a pasted "Smith, John" can't break the filter string.
const cleanNeedle = (q) => q.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()

async function searchCustomers(query) {
  const q = cleanNeedle(query)
  if (q.length < 2) return []
  const digits = digitsOf(q)
  const filters = [
    `last_name.ilike.%${q}%`,
    `first_name.ilike.%${q}%`,
    `email.ilike.%${q}%`,
  ]
  if (digits.length >= 3) {
    filters.push(`phone_primary.ilike.%${digits}%`)
    filters.push(`phone_alt.ilike.%${digits}%`)
  }
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(filters.join(','))
    .or('archived.is.null,archived.eq.false')   // second .or ANDs with the first
    .order('last_name', { ascending: true, nullsFirst: false })
    .limit(30)
  if (error) throw new Error(error.message)
  return data || []
}

export default function CustomersScreen({ who, undo, onOpenJob, onBack }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)   // null = idle/loading, [] = no matches
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)     // expanded customer id
  const [ordersById, setOrdersById] = useState({})  // customer_id -> null(loading) | rows

  const live = useMemo(() => cleanNeedle(q).length >= 2, [q])

  // Debounced server search — 250ms after the last keystroke.
  useEffect(() => {
    if (!live) { setResults(null); setErr(null); return }
    let cancelled = false
    setErr(null)
    const timer = setTimeout(() => {
      searchCustomers(q).then(rows => {
        if (!cancelled) setResults(rows)
      }).catch(e => {
        if (!cancelled) { setResults([]); setErr(e?.message || 'Search failed.') }
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, live])

  const toggle = (c) => {
    const next = openId === c.id ? null : c.id
    setOpenId(next)
    if (next && ordersById[c.id] === undefined) {
      setOrdersById(prev => ({ ...prev, [c.id]: null }))
      supabase
        .from('orders')
        .select('*, cemetery:cemeteries(name)')
        .eq('customer_id', c.id)
        .order('updated_at', { ascending: false })
        .limit(10)
        .then(({ data, error }) => {
          if (error) console.warn('[field] customer orders:', error.message)
          setOrdersById(prev => ({ ...prev, [c.id]: data || [] }))
        })
    }
  }

  const go = (href) => { window.location.href = href }

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; Menu</button>
      )}
      <div className="fl-greet" style={{ marginBottom: 12 }}>Customers</div>

      <input className="fl-search" type="search" placeholder="Search name, phone, email"
        value={q} onChange={e => setQ(e.target.value)} />

      {!live && <div className="fl-empty">Type a family name, phone, or email.</div>}
      {live && err && <div className="fl-empty">{err}</div>}
      {live && !err && results === null && <div className="fl-empty">Searching&#8230;</div>}
      {live && !err && results !== null && results.length === 0 && (
        <div className="fl-empty">No matches.</div>
      )}

      {live && (results || []).map(c => (
        <CustomerRow key={c.id} c={c} open={openId === c.id}
          orders={ordersById[c.id]} onToggle={() => toggle(c)}
          onGo={go} onOpenJob={onOpenJob} />
      ))}
    </div>
  )
}

function CustomerRow({ c, open, orders, onToggle, onGo, onOpenJob }) {
  const phone = c.phone_primary || c.phone_alt || null
  const digits = digitsOf(phone)
  const email = c.email || c.email_alt || null
  const subBits = [c.city, phone].filter(Boolean).join(' · ')

  return (
    <div className="fl-row" onClick={onToggle}>
      <div className="fl-row-flex">
        <div className="fl-row-main">
          <div className="fl-fam" style={{ fontSize: 15.5 }}>{customerName(c)}</div>
          {subBits && <div className="fl-cem">{subBits}</div>}
        </div>
        <span className="fl-chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>&#8250;</span>
      </div>

      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
          {(digits || email) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {digits && (
                <button type="button" className="fl-verb" style={{ flex: 1 }}
                  onClick={() => onGo('tel:' + digits)}>CALL</button>
              )}
              {digits && (
                <button type="button" className="fl-verb" style={{ flex: 1 }}
                  onClick={() => onGo('sms:' + digits)}>TEXT</button>
              )}
              {email && (
                <button type="button" className="fl-verb" style={{ flex: 1 }}
                  onClick={() => onGo('mailto:' + email)}>EMAIL</button>
              )}
            </div>
          )}

          <div style={{ marginTop: 10, borderTop: '1px solid #F0ECE2' }}>
            {orders === null && (
              <div style={{ fontSize: 12.5, color: '#8A8267', padding: '10px 0 4px' }}>Loading orders&#8230;</div>
            )}
            {Array.isArray(orders) && orders.length === 0 && (
              <div style={{ fontSize: 12.5, color: '#8A8267', padding: '10px 0 4px' }}>No orders on file.</div>
            )}
            {Array.isArray(orders) && orders.map(o => (
              <button key={o.id} type="button" className="fl-rowline"
                onClick={() => onOpenJob({ orderId: o.id, jobId: null }, 'menu')}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#16150F' }}>
                    {familyNameOf({ ...o, customer: c })}
                  </span>
                  <span className="fl-spec" style={{ marginLeft: 8 }}>{o.order_number || 'DRAFT'}</span>
                </div>
                <span className={`fl-chip ${STATUS_CHIP[o.status] || 'fl-c-neutral'}`}>
                  {statusInfo(o.status).label.toUpperCase()}
                </span>
                <span className="fl-chev">&#8250;</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
