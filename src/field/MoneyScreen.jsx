// =============================================================================
// MoneyScreen — FIELD-3 owner suite: read-only money overview off the Menu.
// =============================================================================
// Three sections off two fetches (one effect): THIS MONTH stat row (collected
// this month + balance due), RECENT PAYMENTS (last 20 locked non-voided
// payments across every paying order), WHO OWES (open orders by balance desc,
// PAST 60D chip when signed_at is older than 60 days). No writes anywhere —
// payment entry stays at the desk, so `undo` is accepted but never fired.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtUSD, rowBalanceDue, paymentMethodLabel } from '../lib/stonebooksData'
import { familyNameOf, todayISO } from './fieldShared'

const MONO = '"JetBrains Mono", Consolas, monospace'

// Same paged open-orders shape TodayScreen uses — paged so the balance-due
// total never silently truncates.
async function fetchOpenOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customer:customers(*)')
      .neq('status', 'archived')
      .neq('status', 'cancelled')
      .neq('status', 'closed')
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .range(start, start + 999)
    if (error) { console.warn('[field] money orders:', error.message); break }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// Collected-this-month must include orders that CLOSED after paying (an order
// leaving open status must not shrink the month) — narrow query over every
// non-archived order with any payment, mirroring MONEY_PULSE semantics.
async function fetchPaymentOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, payments, primary_lastname, order_number')
    .or('archived.is.null,archived.eq.false')
    .neq('payments', '[]')
  if (error) { console.warn('[field] money payments:', error.message); return [] }
  return data || []
}

// Real money only — the same locked/voided rule every money surface keys on.
const isRealPayment = (p) => (p.locked ?? true) && !p.voided

// Only ever called from useMemo bodies (fixed input string -> pure).
function fmtPayDate(iso) {
  if (!iso) return null
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function MoneyScreen({ who, undo, onOpenJob, onBack }) {
  const [data, setData] = useState(null)   // { orders, payOrders }
  const [err, setErr] = useState(null)
  const [today, setToday] = useState(() => todayISO())   // re-stamped on fetch

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [orders, payOrders] = await Promise.all([
          fetchOpenOrders().catch(() => []),
          fetchPaymentOrders().catch(() => []),
        ])
        if (cancelled) return
        setData({ orders, payOrders })
        setToday(todayISO())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the money view.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Stat row: collected this month across ALL paying orders + balance due
  // across open orders.
  const stats = useMemo(() => {
    if (!data) return null
    const mk = today.slice(0, 7)
    let collected = 0
    for (const o of data.payOrders) {
      const pays = Array.isArray(o.payments) ? o.payments : []
      for (const p of pays) {
        if (isRealPayment(p) && String(p.receivedAt || p.createdAt || '').slice(0, 7) === mk) {
          collected += Number(p.amount) || 0
        }
      }
    }
    let balance = 0
    for (const o of data.orders) balance += rowBalanceDue(o)
    return { collected, balance, openCount: data.orders.length }
  }, [data, today])

  // Every locked non-voided payment across the paying set, newest first.
  const recent = useMemo(() => {
    if (!data) return []
    const out = []
    for (const o of data.payOrders) {
      const pays = Array.isArray(o.payments) ? o.payments : []
      pays.forEach((p, i) => {
        if (!isRealPayment(p)) return
        const at = String(p.receivedAt || p.createdAt || '')
        out.push({ key: `${o.id}-${i}`, order: o, p, at, dateLabel: fmtPayDate(at) })
      })
    }
    out.sort((a, z) => z.at.localeCompare(a.at))
    return out.slice(0, 20)
  }, [data])

  // Open orders with money outstanding, biggest first. Day-granular age off the
  // fetch-time date stamp (noon keeps day math honest) — no impure clock here.
  const owes = useMemo(() => {
    if (!data) return []
    const nowMs = new Date(today + 'T12:00:00').getTime()
    const out = []
    for (const o of data.orders) {
      const bal = rowBalanceDue(o)
      if (bal <= 0) continue
      let past60 = false
      if (o.signed_at) {
        const t = new Date(o.signed_at).getTime()
        past60 = !isNaN(t) && (nowMs - t) / 86400000 > 60
      }
      out.push({ o, bal, past60 })
    }
    out.sort((a, z) => z.bal - a.bal)
    return out.slice(0, 25)
  }, [data, today])

  const openOrder = (o) => onOpenJob({ orderId: o.id, jobId: null }, 'menu')

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Money</div>
      <div className="fl-greet-sub">Read-only &#8212; payment entry stays at the desk</div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && data === null && <div className="fl-empty">Loading the money view&#8230;</div>}
      {!err && data !== null && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">This month</span></div>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div style={{ display: 'flex', gap: 18 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fl-lab">Collected this month</div>
                <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: '#16150F' }}>
                  {fmtUSD(stats.collected)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="fl-lab">Balance due</div>
                <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, color: '#16150F' }}>
                  {fmtUSD(stats.balance)}
                </div>
                <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2 }}>
                  {stats.openCount} open order{stats.openCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          </div>

          <div className="fl-sect">
            <span className="fl-sect-h">Recent payments</span>
            {recent.length > 0 && <span className="fl-sect-pill">{recent.length}</span>}
          </div>
          {recent.length === 0 ? (
            <div className="fl-empty-serif">No payments on the books.</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
              {recent.map(({ key, order, p, dateLabel }) => (
                <button key={key} type="button" className="fl-rowline" onClick={() => openOrder(order)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', lineHeight: 1.35 }}>
                      <span style={{ fontFamily: MONO }}>{fmtUSD(Number(p.amount) || 0)}</span>
                      <span style={{ color: '#6B6456', fontWeight: 600 }}> {paymentMethodLabel(p.method)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{familyNameOf(order)}</span>
                      {order.order_number && <span>{order.order_number}</span>}
                      {dateLabel && <span>{dateLabel}</span>}
                    </div>
                  </div>
                  <span className="fl-chev">&#8250;</span>
                </button>
              ))}
            </div>
          )}

          <div className="fl-sect">
            <span className="fl-sect-h">Who owes</span>
            {owes.length > 0 && <span className="fl-sect-pill">{owes.length}</span>}
          </div>
          {owes.length === 0 ? (
            <div className="fl-empty-serif">Nobody owes a dollar.</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
              {owes.map(({ o, bal, past60 }) => (
                <button key={o.id} type="button" className="fl-rowline" onClick={() => openOrder(o)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#16150F', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {familyNameOf(o)}
                      {o.order_number && <span style={{ color: '#6B6456', fontWeight: 600 }}> &#183; {o.order_number}</span>}
                    </div>
                    {past60 && (
                      <div style={{ marginTop: 2 }}>
                        <span className="fl-chip fl-c-bad">PAST 60D</span>
                      </div>
                    )}
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 700, color: '#16150F', flexShrink: 0 }}>
                    {fmtUSD(bal)}
                  </span>
                  <span className="fl-chev">&#8250;</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
