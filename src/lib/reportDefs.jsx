/* eslint-disable react-refresh/only-export-components */
// =============================================================================
// 📚 Stonebooks — Report registry
// =============================================================================
// This is a data registry (report defs + small JSX bodies), not a component
// module — the constant exports (REPORTS / REPORT_GROUPS) are intentional, so
// Fast Refresh's component-only rule is disabled for the file.
// Each report: { id, title, why, group, daily, compute(bundle, ctx) }. compute
// returns { health, note?, csv, body, value?, prevValue? }. Every value is REAL
// (from the loaded bundle); a report that can't be honestly computed returns a
// `note` ("not yet tracked") instead of fabricating numbers.
// =============================================================================

import {
  rowGrandTotal, rowBalanceDue, fmtUSD, SOLD_STATUSES,
} from './stonebooksData'
import { healthFrom } from './reportsData'

export const REPORT_GROUPS = [
  { code: 'money',       label: 'Money' },
  { code: 'sales',       label: 'Sales' },
  { code: 'operations',  label: 'Operations' },
  { code: 'customers',   label: 'Customers' },
  { code: 'cemeteries',  label: 'Cemeteries' },
  { code: 'forecasting', label: 'Forecasting' },
]

const ESTIMATE_STATUSES = ['scoping', 'quoted']
const daysBetween = (fromIso, toMs) => fromIso ? Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 86400000)) : 0

// ── Shared report bodies ─────────────────────────────────────────────────────
function BucketBars({ buckets, total, onDrill }) {
  const mx = Math.max(1, ...buckets.map(b => b.value))
  return (
    <div className="rb-buckets">
      {buckets.map(b => (
        <button key={b.label} type="button" className="rb-bucket" disabled={!b.ids?.length}
          onClick={() => b.ids?.length && onDrill({ title: b.drillTitle || b.label, ids: b.ids, kind: b.kind || 'orders' })}>
          <span className="rb-bucket-label">{b.label}</span>
          <span className="rb-bucket-track"><span className="rb-bucket-fill" style={{ width: `${(b.value / mx) * 100}%`, background: b.color }} /></span>
          <span className="rb-bucket-val">{fmtUSD(b.value)}<span className="rb-bucket-count"> · {b.count}</span></span>
        </button>
      ))}
      {total != null && <div className="rb-total"><span>Total</span><strong>{fmtUSD(total)}</strong></div>}
    </div>
  )
}

// ── Reports ──────────────────────────────────────────────────────────────────
const RECEIVABLES_AGING = {
  id: 'receivables_aging', group: 'money', daily: true,
  title: 'Receivables Aging',
  why: 'Money already earned that hasn’t come in yet — chase the old buckets first.',
  compute(bundle, ctx) {
    const asOf = ctx.range.end.getTime()
    const acc = { a: { ids: [], v: 0 }, b: { ids: [], v: 0 }, c: { ids: [], v: 0 } }
    for (const o of bundle.orders) {
      if (!SOLD_STATUSES.includes(o.status)) continue
      const bal = rowBalanceDue(o)
      if (bal <= 0) continue
      const days = daysBetween(o.signed_at || o.created_at, asOf)
      const k = days >= 60 ? 'c' : days >= 31 ? 'b' : 'a'
      acc[k].v += bal; acc[k].ids.push(o.id)
    }
    const buckets = [
      { label: '0–30 days', value: acc.a.v, count: acc.a.ids.length, ids: acc.a.ids, color: '#2d7a4f', drillTitle: 'Receivables · 0–30 days' },
      { label: '31–60 days', value: acc.b.v, count: acc.b.ids.length, ids: acc.b.ids, color: '#b8842a', drillTitle: 'Receivables · 31–60 days' },
      { label: '60+ days', value: acc.c.v, count: acc.c.ids.length, ids: acc.c.ids, color: '#b54040', drillTitle: 'Receivables · 60+ days' },
    ]
    const total = buckets.reduce((s, b) => s + b.value, 0)
    const share = total > 0 ? acc.c.v / total : 0
    const health = total === 0 ? 'green' : healthFrom(share, { red: 0.25, yellow: 0.10, invert: true })
    return {
      health, value: total,
      csv: { filename: 'receivables-aging', headers: ['Bucket', 'Amount', 'Count'], rows: buckets.map(b => [b.label, Math.round(b.value), b.count]) },
      body: <BucketBars buckets={buckets} total={total} onDrill={ctx.onDrill} />,
    }
  },
}

const OPEN_QUOTES_AGE = {
  id: 'open_quotes_age', group: 'sales', daily: true,
  title: 'Open Quotes by Age',
  why: 'Quotes go cold fast — the older buckets are the ones to call today.',
  compute(bundle, ctx) {
    const asOf = ctx.range.end.getTime()
    const defs = [
      { key: '0', label: '0–2 days', lo: 0, hi: 2, color: '#2d7a4f' },
      { key: '1', label: '3–7 days', lo: 3, hi: 7, color: '#1d9e75' },
      { key: '2', label: '8–14 days', lo: 8, hi: 14, color: '#b8842a' },
      { key: '3', label: '15–30 days', lo: 15, hi: 30, color: '#d2691e' },
      { key: '4', label: '30+ days', lo: 31, hi: Infinity, color: '#b54040' },
    ]
    const acc = {}; defs.forEach(d => acc[d.key] = { ids: [], v: 0 })
    for (const o of bundle.orders) {
      if (!ESTIMATE_STATUSES.includes(o.status)) continue
      const days = daysBetween(o.created_at, asOf)
      const d = defs.find(x => days >= x.lo && days <= x.hi) || defs[defs.length - 1]
      acc[d.key].v += rowGrandTotal(o); acc[d.key].ids.push(o.id)
    }
    const buckets = defs.map(d => ({ label: d.label, value: acc[d.key].v, count: acc[d.key].ids.length, ids: acc[d.key].ids, color: d.color, drillTitle: `Open quotes · ${d.label}` }))
    const total = buckets.reduce((s, b) => s + b.value, 0)
    const stale = acc['3'].v + acc['4'].v   // 15+ days
    const share = total > 0 ? stale / total : 0
    const health = total === 0 ? 'green' : healthFrom(share, { red: 0.4, yellow: 0.2, invert: true })
    return {
      health, value: total,
      csv: { filename: 'open-quotes-by-age', headers: ['Age bucket', 'Amount', 'Count'], rows: buckets.map(b => [b.label, Math.round(b.value), b.count]) },
      body: <BucketBars buckets={buckets} total={total} onDrill={ctx.onDrill} />,
    }
  },
}

// Registry. (Daily Command = those with daily:true; Library = all, grouped.)
export const REPORTS = [
  RECEIVABLES_AGING,
  OPEN_QUOTES_AGE,
]

export const REPORTS_BY_ID = Object.fromEntries(REPORTS.map(r => [r.id, r]))
