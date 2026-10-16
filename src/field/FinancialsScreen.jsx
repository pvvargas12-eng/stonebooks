// =============================================================================
// FinancialsScreen — the owner's numbers on the phone (Paul 2026-10-16: "I
// need to be able to see my financials in Stonebooks Field").
// =============================================================================
// Read-only. Mirrors the desktop Accounting › Tax center semantics exactly:
//   COLLECTED = locked, non-voided order payments (receivedAt, createdAt as
//               the fallback) — the same rule every money surface keys on.
//   SPENT     = CONFIRMED rows in the Expense book (acct_expenses), write-off
//               or not — what actually left the account.
//   NET       = collected − spent.
//   SIGNED    = contract value (rowGrandTotal) of orders signed in the period.
//   OWED      = balance due across open orders, all time.
// Period chips: this month / last month / this year / last year. A by-month
// table for the chosen year sits under the tiles, then where the money went
// (expense categories). Money entry stays on the Money screen.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { fmtUSD, rowGrandTotal, rowBalanceDue } from '../lib/stonebooksData'
import { listAcctExpenses, schedcLabel } from '../lib/acctData'
import { todayISO } from './fieldShared'

const MONO = '"JetBrains Mono", Consolas, monospace'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const OPEN_EXCLUDED = new Set(['closed', 'cancelled', 'archived'])

const isRealPayment = (p) => p && (p.locked ?? true) && !p.voided
const payDate = (p) => String(p.receivedAt || p.createdAt || '').slice(0, 10)

// Every non-archived order, paged so a year never silently truncates.
async function fetchOrders() {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .or('archived.is.null,archived.eq.false')
      .order('id', { ascending: true })
      .range(start, start + 999)
    if (error) { console.warn('[field] financials orders:', error.message); break }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Period definitions off the fetch-time date stamp (pure: fixed string in).
function periodsFor(today) {
  const d = new Date(today + 'T12:00:00')
  const thisM = ym(d)
  const lm = new Date(d); lm.setMonth(lm.getMonth() - 1)
  const lastM = ym(lm)
  const y = String(d.getFullYear()), ly = String(d.getFullYear() - 1)
  const mName = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`
  return [
    { key: 'month',     label: 'This month', title: mName(thisM), year: y,  inP: (iso) => iso.slice(0, 7) === thisM },
    { key: 'lastmonth', label: 'Last month', title: mName(lastM), year: lastM.slice(0, 4), inP: (iso) => iso.slice(0, 7) === lastM },
    { key: 'year',      label: y,            title: `${y} to date`, year: y, inP: (iso) => iso.slice(0, 4) === y },
    { key: 'lastyear',  label: ly,           title: ly, year: ly, inP: (iso) => iso.slice(0, 4) === ly },
  ]
}

export default function FinancialsScreen({ onBack }) {
  const [data, setData] = useState(null)   // { orders, expenses }
  const [err, setErr] = useState(null)
  const [today, setToday] = useState(() => todayISO())
  const [pick, setPick] = useState('month')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [orders, expenses] = await Promise.all([
          fetchOrders().catch(() => []),
          listAcctExpenses({ limit: 4000 }).catch(() => []),
        ])
        if (cancelled) return
        setData({ orders, expenses })
        setToday(todayISO())
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load the financials.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const periods = useMemo(() => periodsFor(today), [today])
  const period = periods.find(p => p.key === pick) || periods[0]

  const stats = useMemo(() => {
    if (!data) return null
    let collected = 0, spent = 0, signedUsd = 0, signedN = 0, owed = 0, openN = 0
    const byCat = new Map()
    const months = new Map()   // 'YYYY-MM' -> { collected, spent }
    const bump = (k, f, v) => { if (!k || k.slice(0, 4) !== period.year) return; const m = months.get(k) || { collected: 0, spent: 0 }; m[f] += v; months.set(k, m) }
    for (const o of data.orders) {
      for (const p of (Array.isArray(o.payments) ? o.payments : [])) {
        if (!isRealPayment(p)) continue
        const d = payDate(p); const amt = Number(p.amount) || 0
        if (period.inP(d)) collected += amt
        bump(d.slice(0, 7), 'collected', amt)
      }
      if (o.signed_at && period.inP(String(o.signed_at).slice(0, 10)) && o.status !== 'cancelled') { signedN += 1; signedUsd += rowGrandTotal(o) }
      if (!OPEN_EXCLUDED.has(o.status)) { const b = rowBalanceDue(o); if (b > 0) { owed += b; openN += 1 } }
    }
    for (const e of data.expenses) {
      if (e.status !== 'confirmed') continue
      const d = String(e.expense_date || '').slice(0, 10); const amt = Number(e.amount) || 0
      if (!d) continue
      bump(d.slice(0, 7), 'spent', amt)
      if (!period.inP(d)) continue
      spent += amt
      const c = e.category || 'other'
      byCat.set(c, (byCat.get(c) || 0) + amt)
    }
    const cats = [...byCat.entries()].sort((a, z) => z[1] - a[1]).slice(0, 8)
    const rows = []
    for (let i = 0; i < 12; i++) {
      const k = `${period.year}-${String(i + 1).padStart(2, '0')}`
      if (k > today.slice(0, 7)) break
      const m = months.get(k) || { collected: 0, spent: 0 }
      rows.push({ k, label: MONTHS[i], ...m, net: m.collected - m.spent })
    }
    const peak = Math.max(1, ...rows.map(r => Math.max(r.collected, r.spent)))
    return { collected, spent, net: collected - spent, signedUsd, signedN, owed, openN, cats, rows, peak }
  }, [data, period, today])

  const tile = (label, value, { tone = null, sub = null } = {}) => (
    <div style={{ flex: '1 1 46%', minWidth: 0 }}>
      <div className="fl-lab">{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: tone === 'bad' ? '#B00020' : tone === 'good' ? '#1F7A3A' : '#16150F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#8A7F6C', marginTop: 2, overflowWrap: 'anywhere' }}>{sub}</div>}
    </div>
  )

  return (
    <div>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Financials</div>
      <div className="fl-greet-sub">Collected, spent, net — the Accounting numbers, on the phone</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        {periods.map(p => (
          <button key={p.key} type="button" onClick={() => setPick(p.key)} aria-pressed={pick === p.key}
            style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', minHeight: 36,
              background: pick === p.key ? '#16150F' : '#fff', color: pick === p.key ? '#E9C46A' : '#55503F', border: `1px solid ${pick === p.key ? '#16150F' : '#E2DCCE'}` }}>
            {p.label}
          </button>
        ))}
      </div>

      {err && <div className="fl-empty">{err}</div>}
      {!err && data === null && <div className="fl-empty">Adding it up&#8230;</div>}
      {!err && stats && (
        <>
          <div className="fl-sect"><span className="fl-sect-h">{period.title}</span></div>
          <div className="fl-row" style={{ cursor: 'default' }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', rowGap: 14 }}>
              {tile('Collected', fmtUSD(stats.collected), { sub: 'order payments in' })}
              {tile('Spent', fmtUSD(stats.spent), { sub: 'confirmed in the Expense book' })}
              {tile('Net', fmtUSD(stats.net), { tone: stats.net < 0 ? 'bad' : 'good', sub: 'collected minus spent' })}
              {tile('Signed', fmtUSD(stats.signedUsd), { sub: `${stats.signedN} contract${stats.signedN === 1 ? '' : 's'} signed` })}
            </div>
          </div>

          <div className="fl-row" style={{ cursor: 'default', marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 14 }}>
              {tile('Still owed to us', fmtUSD(stats.owed), { tone: stats.owed > 0 ? 'bad' : null, sub: `${stats.openN} open order${stats.openN === 1 ? '' : 's'} with a balance — all time` })}
            </div>
          </div>

          <div className="fl-sect"><span className="fl-sect-h">By month &middot; {period.year}</span></div>
          {stats.rows.length === 0 ? (
            <div className="fl-empty-serif">Nothing on the books for {period.year} yet.</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '6px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr', gap: '0 8px', fontSize: 10.5, color: '#8A7F6C', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 0 6px', borderBottom: '1px solid #F0ECE2' }}>
                <span></span><span style={{ textAlign: 'right' }}>In</span><span style={{ textAlign: 'right' }}>Spent</span><span style={{ textAlign: 'right' }}>Net</span>
              </div>
              {stats.rows.map(r => (
                <div key={r.k} style={{ borderBottom: '1px solid #F0ECE2', padding: '7px 0' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 1fr 1fr', gap: '0 8px', alignItems: 'baseline', fontFamily: MONO, fontSize: 12.5, minWidth: 0 }}>
                    <span style={{ fontFamily: 'inherit', fontWeight: 700, color: '#55503F' }}>{r.label}</span>
                    <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtUSD(r.collected)}</span>
                    <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', color: '#6B6456' }}>{fmtUSD(r.spent)}</span>
                    <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, color: r.net < 0 ? '#B00020' : '#1F7A3A' }}>{fmtUSD(r.net)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, marginTop: 4, height: 4 }}>
                    <span style={{ width: `${Math.round((r.collected / stats.peak) * 100)}%`, background: '#1F7A3A', borderRadius: 2 }}></span>
                    <span style={{ width: `${Math.round((r.spent / stats.peak) * 100)}%`, background: '#C9A468', borderRadius: 2 }}></span>
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#8A7F6C', marginTop: 8 }}>Green bar = collected, gold bar = spent.</div>
            </div>
          )}

          <div className="fl-sect"><span className="fl-sect-h">Where it went</span>{stats.cats.length > 0 && <span className="fl-sect-pill">{period.label}</span>}</div>
          {stats.cats.length === 0 ? (
            <div className="fl-empty-serif">No confirmed expenses in this period.</div>
          ) : (
            <div className="fl-row" style={{ cursor: 'default', padding: '4px 14px' }}>
              {stats.cats.map(([c, usd]) => (
                <div key={c} className="fl-statusrow">
                  <span className="lab" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{schedcLabel(c)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 10 }}>{fmtUSD(usd)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: '#8A7F6C', textAlign: 'center', margin: '16px 8px 4px', overflowWrap: 'anywhere' }}>
            Same rules as Accounting on the desktop: payments count on the day they were received, expenses once they are confirmed in the Expense book. Record payments on the Money screen; snap receipts on Receipt.
          </div>
        </>
      )}
    </div>
  )
}
