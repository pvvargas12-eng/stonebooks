// =============================================================================
// PaymentsScreen — the PAYMENTS tab on the phone (Paul 2026-10-30: "I want to
// see payments in Field, and money on the table, in a Payments tab").
// =============================================================================
// Two views off one load, the same truths the desktop reads:
//   PAYMENTS      money IN — every locked, non-voided order payment, newest
//                 first, by period (this month / last month / this year / all),
//                 total + count + by method, search by family or order number,
//                 tap → the order. RECORD A PAYMENT opens the shared sheet.
//   ON THE TABLE  money still OWED on work that is moving — the Collect
//                 balances queues (lib/collections): INSTALLED still owed (red,
//                 with the days), DELIVERY queue, BLASTING queue, with the
//                 promise-to-pay when one is logged; plus the open balances
//                 that are not in any queue yet, so the total reconciles to
//                 "everything owed".
// Read-mostly: the only write is the payment sheet (standard 8s undo).
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtUSD, fmtDate, rowBalanceDue, rowGrandTotal, rowTotalPaid, paymentMethodLabel, properName } from '../lib/stonebooksData'
import { getCollectionQueues, listCollectionLog, STAGES, activePromiseOf, promiseMissed, daysAgo } from '../lib/collections'
import { familyNameOf, todayISO } from './fieldShared'
import RecordPaymentSheet from './RecordPaymentSheet'

const MONO = '"JetBrains Mono", Consolas, monospace'
const OPEN_EXCLUDED = new Set(['closed', 'cancelled', 'archived'])
const isRealPayment = (p) => p && (p.locked ?? true) && !p.voided
const payDay = (p) => String(p.receivedAt || p.createdAt || '').slice(0, 10)

// Every open order (status + archive flag), paged so the owed total never
// silently truncates. Customer for the name, cemetery for the queue row.
async function fetchOpenOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customer:customers(id, first_name, last_name, email, phone_primary), cemetery:cemeteries(id, name)')
      .neq('status', 'archived').neq('status', 'cancelled').neq('status', 'closed')
      .or('archived.is.null,archived.eq.false')
      .order('updated_at', { ascending: false })
      .range(start, start + 999)
    if (error) { console.warn('[field] payments orders:', error.message); break }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// Every non-archived order that ever took a payment — closed ones included,
// a paid-and-closed order must not shrink a month.
async function fetchPaymentOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, payments, primary_lastname, order_number, customer:customers(id, first_name, last_name)')
      .or('archived.is.null,archived.eq.false')
      .neq('payments', '[]')
      .order('id', { ascending: true })
      .range(start, start + 999)
    if (error) { console.warn('[field] payments list:', error.message); break }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

function periodsFor(today) {
  const y = today.slice(0, 4), m = today.slice(0, 7)
  const d = new Date(today + 'T12:00:00'); d.setMonth(d.getMonth() - 1)
  const lm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return [
    { key: 'month', label: 'This month', inP: (day) => day.slice(0, 7) === m },
    { key: 'last',  label: 'Last month', inP: (day) => day.slice(0, 7) === lm },
    { key: 'year',  label: `${y}`,       inP: (day) => day.slice(0, 4) === y },
    { key: 'all',   label: 'All time',   inP: () => true },
  ]
}

const fmtShort = (day) => {
  if (!day) return ''
  const d = new Date(day + 'T00:00:00')
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const STAGE_TONE = { installed: 'fl-c-bad', delivery: 'fl-c-good', blast: 'fl-c-warn', other: 'fl-c-neutral' }
const stageDetail = (r) => {
  if (r.stage === 'installed') return `installed ${r.installedDate ? fmtDate(r.installedDate) : ''}${r.installedDays != null ? ` · ${r.installedDays} day${r.installedDays === 1 ? '' : 's'} ago` : ''}`.trim()
  if (r.stage === 'delivery') return r.bronze ? 'bronze arrived' : r.detail === 'blasted' ? 'blasted, ready to set' : r.scheduledDate ? `install list · ${fmtShort(r.scheduledDate)}` : 'on the install list'
  if (r.stage === 'blast') return r.line ? `${r.line}${r.phase ? ` · ${String(r.phase).replace(/_/g, ' ')}` : ''}` : 'on a line'
  return 'not in production yet'
}

export default function PaymentsScreen({ who, undo, onOpenJob, onBack, preload = null }) {
  const [view, setView] = useState('in')          // 'in' | 'table'
  const [data, setData] = useState(null)          // { orders, payOrders, queues, log }
  const [err, setErr] = useState(null)
  const [today, setToday] = useState(() => todayISO())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [rev, setRev] = useState(0)
  const [pick, setPick] = useState('month')
  const [q, setQ] = useState('')
  const [stageF, setStageF] = useState(null)      // null = every queued row
  const [limit, setLimit] = useState(60)
  const [recOpen, setRecOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (preload) { setData(preload); return undefined }   // smoke mounts only
    ;(async () => {
      try {
        const [orders, payOrders, queues] = await Promise.all([
          fetchOpenOrders().catch(() => []),
          fetchPaymentOrders().catch(() => []),
          getCollectionQueues().catch(() => new Map()),
        ])
        if (cancelled) return
        // Promises only matter on the rows that owe money in a queue.
        const ids = orders.filter(o => queues.has(o.id) && rowBalanceDue(o) > 0).map(o => o.id)
        const log = ids.length ? await listCollectionLog(ids).catch(() => new Map()) : new Map()
        if (cancelled) return
        setData({ orders, payOrders, queues, log })
        setToday(todayISO()); setNowMs(Date.now())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load payments.')
      }
    })()
    return () => { cancelled = true }
  }, [rev, preload])

  const periods = useMemo(() => periodsFor(today), [today])
  const period = periods.find(p => p.key === pick) || periods[0]

  // ── money in ──────────────────────────────────────────────────────────────
  const payments = useMemo(() => {
    if (!data) return []
    const out = []
    for (const o of data.payOrders) {
      const pays = Array.isArray(o.payments) ? o.payments : []
      pays.forEach((p, i) => {
        if (!isRealPayment(p)) return
        const day = payDay(p)
        if (!period.inP(day)) return
        out.push({ key: `${o.id}-${i}`, order: o, p, day, amount: Number(p.amount) || 0, method: paymentMethodLabel(p.method), name: familyNameOf(o) })
      })
    }
    out.sort((a, z) => z.day.localeCompare(a.day))
    return out
  }, [data, period])
  const inStats = useMemo(() => {
    let total = 0; const byMethod = new Map()
    for (const r of payments) { total += r.amount; byMethod.set(r.method, (byMethod.get(r.method) || 0) + r.amount) }
    const methods = [...byMethod.entries()].sort((a, z) => z[1] - a[1])
    return { total, n: payments.length, methods }
  }, [payments])
  const shownPayments = useMemo(() => {
    const norm = q.trim().toLowerCase()
    if (!norm) return payments
    return payments.filter(r => `${r.name} ${r.order.order_number || ''} ${r.method} ${r.p.note || ''}`.toLowerCase().includes(norm))
  }, [payments, q])

  // ── on the table ──────────────────────────────────────────────────────────
  const table = useMemo(() => {
    if (!data) return { rows: [], by: {}, owedAll: 0, nAll: 0, otherOwed: 0, otherN: 0 }
    const rows = []; const by = {}
    for (const s of STAGES) by[s.code] = { owed: 0, n: 0 }
    let owedAll = 0, nAll = 0, otherOwed = 0, otherN = 0
    for (const o of data.orders) {
      if (OPEN_EXCLUDED.has(o.status)) continue
      const balance = rowBalanceDue(o)
      if (balance <= 0) continue
      owedAll += balance; nAll += 1
      const e = data.queues.get(o.id)
      const entries = data.log.get(o.id) || []
      const promise = activePromiseOf(entries)
      const row = {
        id: o.id, order: o, name: familyNameOf(o), balance, total: rowGrandTotal(o), paid: rowTotalPaid(o),
        cemetery: o.cemetery?.name ? properName(o.cemetery.name) : '',
        stage: e?.stage || 'other', stages: e?.stages || new Set(), detail: e?.detail, bronze: !!e?.bronze, line: e?.line, phase: e?.phase,
        scheduledDate: e?.scheduledDate || null, installedDate: e?.installedDate || null,
        installedDays: e?.installedDate ? daysAgo(`${e.installedDate}T12:00:00`, nowMs) : null,
        promise, promiseMissed: promiseMissed(promise, today),
      }
      if (e) { for (const s of row.stages) if (by[s]) { by[s].owed += balance; by[s].n += 1 } }
      else { otherOwed += balance; otherN += 1 }
      rows.push(row)
    }
    const rank = { installed: 0, delivery: 1, blast: 2, other: 3 }
    rows.sort((a, z) => (rank[a.stage] - rank[z.stage]) || (z.balance - a.balance))
    return { rows, by, owedAll, nAll, otherOwed, otherN }
  }, [data, nowMs, today])
  const shownTable = useMemo(() => {
    const norm = q.trim().toLowerCase()
    return table.rows.filter(r => {
      if (stageF === 'other' ? r.stage !== 'other' : stageF ? !r.stages.has(stageF) : r.stage === 'other') return false
      if (norm && !`${r.name} ${r.order.order_number || ''} ${r.cemetery}`.toLowerCase().includes(norm)) return false
      return true
    })
  }, [table, stageF, q])

  const openOrder = (o) => onOpenJob({ orderId: o.id, jobId: null }, onBack ? 'more' : 'payments')
  const switchView = (v) => { setView(v); setQ(''); setLimit(60) }

  return (
    <div className="fl-pay">
      <style>{PAY_CSS}</style>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>&#8249; More</button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Payments</div>
      <div className="fl-greet-sub">Money in, and the money still on the table</div>

      <div className="fl-seg" style={{ marginTop: 12 }}>
        <button type="button" className={view === 'in' ? 'on' : ''} onClick={() => switchView('in')}>Payments</button>
        <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => switchView('table')}>On the table</button>
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && data === null && <div className="fl-empty">Loading payments&#8230;</div>}

      {!err && data !== null && view === 'in' && (
        <>
          <button type="button" className="fl-btn fl-btn-gold" onClick={() => setRecOpen(true)}>Record a payment</button>
          <div className="fl-filters" style={{ marginTop: 12 }}>
            {periods.map(p => (
              <button key={p.key} type="button" className={`fl-fchip ${pick === p.key ? 'on' : ''}`} onClick={() => { setPick(p.key); setLimit(60) }}>{p.label}</button>
            ))}
          </div>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div className="fl-lab">Collected &middot; {period.label}</div>
            <div className="fl-pay-big">{fmtUSD(inStats.total)}</div>
            <div className="fl-pay-sub">{inStats.n} payment{inStats.n === 1 ? '' : 's'}{inStats.methods.length > 0 && <> &middot; {inStats.methods.map(([m, v]) => `${m} ${fmtUSD(v)}`).join(' · ')}</>}</div>
          </div>

          <input className="fl-search" placeholder="Family, order number, method…" value={q} onChange={e => { setQ(e.target.value); setLimit(60) }} style={{ marginTop: 12 }} />

          <div className="fl-sect">
            <span className="fl-sect-h">Payments</span>
            {shownPayments.length > 0 && <span className="fl-sect-pill">{shownPayments.length}</span>}
          </div>
          {shownPayments.length === 0 ? (
            <div className="fl-empty-serif">{q ? 'Nothing matches.' : `No payments ${period.key === 'all' ? 'on the books' : period.label.toLowerCase()}.`}</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
              {shownPayments.slice(0, limit).map(r => (
                <button key={r.key} type="button" className="fl-rowline" onClick={() => openOrder(r.order)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fl-pay-name">{r.name}{r.order.order_number && <span className="fl-pay-dim"> &middot; {r.order.order_number}</span>}</div>
                    <div className="fl-pay-meta">{r.method}{r.day && <> &middot; {fmtShort(r.day)}{period.key === 'all' || period.key === 'year' ? `, ${r.day.slice(0, 4)}` : ''}</>}{r.p.note ? <> &middot; {r.p.note}</> : null}</div>
                  </div>
                  <span className="fl-pay-amt">{fmtUSD(r.amount)}</span>
                  <span className="fl-chev">&#8250;</span>
                </button>
              ))}
              {shownPayments.length > limit && (
                <button type="button" className="fl-btn fl-btn-ghost" style={{ margin: '8px 0 6px' }} onClick={() => setLimit(l => l + 100)}>
                  Show more &middot; {shownPayments.length - limit} left
                </button>
              )}
            </div>
          )}
        </>
      )}

      {!err && data !== null && view === 'table' && (
        <>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div className="fl-lab">Everything owed &middot; open orders</div>
            <div className="fl-pay-big">{fmtUSD(table.owedAll)}</div>
            <div className="fl-pay-sub">{table.nAll} order{table.nAll === 1 ? '' : 's'} with a balance</div>
          </div>

          <div className="fl-sect"><span className="fl-sect-h">Money on the table</span></div>
          <div className="fl-tilegrid">
            {STAGES.map(s => {
              const t = table.by[s.code] || { owed: 0, n: 0 }
              const on = stageF === s.code
              return (
                <button key={s.code} type="button" className={`fl-tile fl-pay-tile ${on ? 'on' : ''} ${s.code === 'installed' ? 'red' : ''}`} onClick={() => setStageF(on ? null : s.code)}>
                  <div className="fl-tile-main">
                    <div className="fl-tile-name">{s.label}</div>
                    <div className="fl-tile-sub">{t.n} order{t.n === 1 ? '' : 's'} &middot; {s.sub}</div>
                  </div>
                  <div className="fl-tile-count">{fmtUSD(t.owed)}</div>
                </button>
              )
            })}
            <button type="button" className={`fl-tile fl-pay-tile ${stageF === 'other' ? 'on' : ''}`} onClick={() => setStageF(stageF === 'other' ? null : 'other')}>
              <div className="fl-tile-main">
                <div className="fl-tile-name" style={{ color: '#6B6456' }}>Not in production yet</div>
                <div className="fl-tile-sub">{table.otherN} order{table.otherN === 1 ? '' : 's'} &middot; owed, but nothing to collect on yet</div>
              </div>
              <div className="fl-tile-count" style={{ color: '#6B6456' }}>{fmtUSD(table.otherOwed)}</div>
            </button>
          </div>

          <input className="fl-search" placeholder="Family, order number, cemetery…" value={q} onChange={e => { setQ(e.target.value); setLimit(60) }} style={{ marginTop: 12 }} />

          <div className="fl-sect">
            <span className="fl-sect-h">{stageF === 'other' ? 'Not in production yet' : stageF ? (STAGES.find(s => s.code === stageF)?.label || '') : 'In the queues'}</span>
            {shownTable.length > 0 && <span className="fl-sect-pill">{shownTable.length}</span>}
            {stageF && <button type="button" className="fl-sect-see" onClick={() => setStageF(null)}>All queues</button>}
          </div>
          {shownTable.length === 0 ? (
            <div className="fl-empty-serif">{q ? 'Nothing matches.' : 'Nothing owed here.'}</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
              {shownTable.slice(0, limit).map(r => (
                <button key={r.id} type="button" className="fl-rowline" onClick={() => openOrder(r.order)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={`fl-pay-name ${r.stage === 'installed' ? 'red' : ''}`}>{r.name}{r.order.order_number && <span className="fl-pay-dim"> &middot; {r.order.order_number}</span>}</div>
                    <div className="fl-pay-meta">
                      <span className={`fl-chip ${STAGE_TONE[r.stage]}`}>{r.stage === 'other' ? 'OPEN' : (STAGES.find(s => s.code === r.stage)?.short || r.stage)}</span>
                      <span>{stageDetail(r)}</span>
                      {r.cemetery && <span>&middot; {r.cemetery}</span>}
                    </div>
                    {r.promise && (
                      <div className="fl-pay-meta" style={{ marginTop: 3 }}>
                        <span className={`fl-chip ${r.promiseMissed ? 'fl-c-bad' : 'fl-c-info'}`}>{r.promiseMissed ? 'PROMISE MISSED' : 'PROMISED'}</span>
                        <span>{fmtDate(r.promise.promised_for)}{r.promise.note ? ` · ${r.promise.note}` : ''}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className={`fl-pay-amt ${r.stage === 'installed' ? 'red' : ''}`}>{fmtUSD(r.balance)}</div>
                    <div className="fl-pay-sub" style={{ marginTop: 0 }}>of {fmtUSD(r.total)}</div>
                  </div>
                  <span className="fl-chev">&#8250;</span>
                </button>
              ))}
              {shownTable.length > limit && (
                <button type="button" className="fl-btn fl-btn-ghost" style={{ margin: '8px 0 6px' }} onClick={() => setLimit(l => l + 100)}>
                  Show more &middot; {shownTable.length - limit} left
                </button>
              )}
            </div>
          )}
        </>
      )}

      {recOpen && (
        <RecordPaymentSheet orders={data?.orders || []} undo={undo}
          onClose={() => setRecOpen(false)} onRecorded={() => setRev(r => r + 1)} />
      )}
    </div>
  )
}

// Phone-fit extras on top of FIELD_CSS. Every text block wraps or clips —
// nothing escapes its row (the overflow doctrine).
const PAY_CSS = `
  .fl-pay .fl-pay-big { font-family: ${MONO}; font-size: 26px; font-weight: 700; color: #16150F; margin-top: 2px; overflow-wrap: anywhere; }
  .fl-pay .fl-pay-sub { font-size: 11.5px; color: #8A7F6C; margin-top: 3px; overflow-wrap: anywhere; }
  .fl-pay .fl-pay-name { font-size: 14.5px; font-weight: 700; color: #16150F; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fl-pay .fl-pay-name.red { color: #B3261E; font-weight: 800; }
  .fl-pay .fl-pay-dim { color: #6B6456; font-weight: 600; }
  .fl-pay .fl-pay-meta { font-size: 11.5px; color: #8A7F6C; margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; overflow-wrap: anywhere; }
  .fl-pay .fl-pay-amt { font-family: ${MONO}; font-size: 14.5px; font-weight: 700; color: #16150F; flex-shrink: 0; white-space: nowrap; }
  .fl-pay .fl-pay-amt.red { color: #B3261E; font-weight: 800; }
  .fl-pay .fl-pay-tile.on { border-color: #16150F; box-shadow: inset 0 0 0 1px #16150F; }
  .fl-pay .fl-pay-tile.red .fl-tile-name, .fl-pay .fl-pay-tile.red .fl-tile-count { color: #B3261E; }
  .fl-pay .fl-tile-count { font-family: ${MONO}; font-size: 17px; white-space: nowrap; flex-shrink: 0; }
  .fl-pay .fl-tile-name, .fl-pay .fl-tile-sub { overflow-wrap: anywhere; }
  .fl-pay .fl-search { width: 100%; box-sizing: border-box; }
`
