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

import { useState } from 'react'
import {
  rowGrandTotal, rowBalanceDue, rowTotalPaid, fmtUSD, customerName, SOLD_STATUSES,
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

const JOB_CLOSED = ['closed', 'cancelled', 'archived', 'paid', 'completed']
const isActiveJob = (j) => j && !JOB_CLOSED.includes(j.overall_status)
const msDone = (j, key) => (j?.milestones || []).some(m => m.milestone_key === key && m.status === 'done')

// Workflow stage taxonomy (mirrors the Profit/Jobs group order).
const STAGE_ORDER = ['intake', 'design', 'permit', 'stone', 'photo', 'etching', 'production', 'foundation', 'install', 'closeout']
const STAGE_LABEL = { intake: 'Intake', design: 'Design', permit: 'Permit', stone: 'Stone', photo: 'Photo', etching: 'Etching', production: 'Production', foundation: 'Foundation', install: 'Install', closeout: 'Closeout' }
const STAGE_COLOR = { intake: '#5d5d5a', design: '#7c3aed', permit: '#b8842a', stone: '#1d4ed8', photo: '#0d9488', etching: '#0d9488', production: '#534AB7', foundation: '#d2691e', install: '#1D9E75', closeout: '#2d7a4f' }
// First open (actionable) milestone's group = the job's current stage.
function currentStage(job) {
  const open = (job?.milestones || [])
    .filter(m => m.status !== 'done' && m.status !== 'not_needed')
    .sort((a, b) => (STAGE_ORDER.indexOf(a.group) - STAGE_ORDER.indexOf(b.group)) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)))
  return open.length ? (open[0].group || 'intake') : 'closeout'
}
const ageColor = (d) => d >= 30 ? '#b54040' : d >= 14 ? '#d2691e' : d >= 7 ? '#b8842a' : '#2d7a4f'
const msDate = (j, key) => { const m = (j?.milestones || []).find(x => x.milestone_key === key && x.status === 'done'); return m?.status_date || null }
function jobName(j) {
  const o = j?.order
  if (o?.primary_lastname && String(o.primary_lastname).trim()) return String(o.primary_lastname).trim()
  const cn = customerName(o?.customer)
  return (cn && cn !== '—') ? cn : (o?.order_number || String(j?.id || '').slice(0, 8))
}
// Order-tagged outgoing spend → { byOrder: {id: total}, catByOrder: {id: {cat: $}} }
function outgoingByOrder(outgoing) {
  const byOrder = {}, catByOrder = {}
  for (const o of outgoing || []) {
    if (!o.order_id) continue
    byOrder[o.order_id] = (byOrder[o.order_id] || 0) + (Number(o.amount) || 0)
    ;(catByOrder[o.order_id] ||= {})
    const c = o.category || 'Other'
    catByOrder[o.order_id][c] = (catByOrder[o.order_id][c] || 0) + (Number(o.amount) || 0)
  }
  return { byOrder, catByOrder }
}

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

function StackBar({ segments, onDrill }) {
  const active = segments.filter(s => s.value > 0)
  const total = active.reduce((s, x) => s + x.value, 0)
  return (
    <>
      {total > 0 ? (
        <div className="rb-stack">
          {active.map(s => (
            <button key={s.label} type="button" className="rb-stack-seg" style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${fmtUSD(s.value)}`} onClick={() => onDrill({ title: s.label, ids: s.ids, kind: s.kind || 'orders' })} />
          ))}
        </div>
      ) : <div className="rb-empty">Nothing at risk right now.</div>}
      <div className="rb-legend">
        {segments.map(s => (
          <button key={s.label} type="button" className="rb-legend-item" disabled={!s.ids?.length}
            onClick={() => s.ids?.length && onDrill({ title: s.label, ids: s.ids, kind: s.kind || 'orders' })}>
            <span className="rb-legend-dot" style={{ background: s.color }} /> {s.label}
            <span className="rb-legend-val">{fmtUSD(s.value)}</span><span className="rb-bucket-count"> · {s.count ?? s.ids?.length ?? 0}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// Stage table — count / $ in stage / avg days / oldest, colored by aging.
function StageTable({ rows, onDrill }) {
  if (!rows.length) return <div className="rb-empty">No active jobs in any stage.</div>
  return (
    <div className="rb-stage-table">
      <div className="rb-stage-row rb-stage-head">
        <div>Stage</div><div className="num">Jobs</div><div className="num">$ in stage</div><div className="num">Avg days</div><div className="num">Oldest</div>
      </div>
      {rows.map(r => (
        <button key={r.stage} type="button" className="rb-stage-row" onClick={() => onDrill({ title: `${r.label} stage`, ids: r.ids, kind: 'jobs' })}>
          <div className="rb-stage-name"><span className="rb-stage-dot" style={{ background: STAGE_COLOR[r.stage] || '#888' }} />{r.label}</div>
          <div className="num">{r.count}</div>
          <div className="num rb-bucket-val">{fmtUSD(r.value)}</div>
          <div className="num" style={{ color: ageColor(r.avgDays), fontWeight: 600 }}>{r.avgDays}d</div>
          <div className="num" style={{ color: ageColor(r.oldest) }}>{r.oldest}d</div>
        </button>
      ))}
    </div>
  )
}

// Sortable table body. columns: [{ key, label, num?, fmt? }]; rows carry the
// raw values + _id/_kind for drill. Click a header to sort.
function SortableTable({ columns, rows, grid, initialSort, onDrill, maxRows = 200 }) {
  const [sort, setSort] = useState(initialSort || { key: columns[0].key, dir: 'desc' })
  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key]
    let cmp
    if (typeof va === 'number' || typeof vb === 'number') cmp = (Number(va) || 0) - (Number(vb) || 0)
    else cmp = String(va ?? '').localeCompare(String(vb ?? ''))
    return sort.dir === 'asc' ? cmp : -cmp
  }).slice(0, maxRows)
  const click = (k) => setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' })
  return (
    <div className="rb-tbl-wrap">
      <div className="rb-tbl">
        <div className="rb-tbl-row rb-tbl-head" style={{ gridTemplateColumns: grid }}>
          {columns.map(c => (
            <button key={c.key} type="button" className={`rb-tbl-h ${c.num ? 'num' : ''} ${sort.key === c.key ? 'on' : ''}`} onClick={() => click(c.key)}>
              {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
        {sorted.map(r => (
          <button key={r._id} type="button" className="rb-tbl-row rb-tbl-data" style={{ gridTemplateColumns: grid }}
            onClick={() => r._id && onDrill?.({ title: r._drillTitle || 'Detail', ids: r._ids || [r._id], kind: r._kind || 'jobs' })}>
            {columns.map(c => <span key={c.key} className={c.num ? 'num' : ''}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</span>)}
          </button>
        ))}
      </div>
      {rows.length > maxRows && <div className="rb-tbl-more">Showing top {maxRows} of {rows.length}.</div>}
    </div>
  )
}

function StatGrid({ stats, onClick }) {
  return (
    <div className="rb-stats">
      {stats.map(s => (
        <button key={s.label} type="button" className="rb-stat" disabled={!onClick} onClick={onClick}>
          <div className="rb-stat-val">{s.fmt ? s.fmt(s.value) : s.value}</div>
          <div className="rb-stat-label">{s.label}</div>
        </button>
      ))}
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

const MONEY_AT_RISK = {
  id: 'money_at_risk', group: 'money', daily: true,
  title: 'Today’s Money at Risk',
  why: 'The dollars most likely to slip away — chase these before anything else.',
  compute(bundle, ctx) {
    const asOf = ctx.range.end.getTime()
    const jobByOrder = {}; for (const j of bundle.jobs) if (j.order_id && !jobByOrder[j.order_id]) jobByOrder[j.order_id] = j
    const S = { done: { ids: [], v: 0 }, dep: { ids: [], v: 0 }, appr: { ids: [], v: 0 }, quote: { ids: [], v: 0 }, close: { ids: [], v: 0 } }
    for (const o of bundle.orders) {
      const job = jobByOrder[o.id]
      const bal = rowBalanceDue(o), paid = rowTotalPaid(o), grand = rowGrandTotal(o)
      const completed = (job && (msDone(job, 'installed') || msDone(job, 'work_completed') || msDone(job, 'door_installed'))) || ['installed', 'paid_in_full', 'closed'].includes(o.status)
      const sold = SOLD_STATUSES.includes(o.status)
      const awaiting = job && msDone(job, 'proof_sent') && !msDone(job, 'proof_approved')
      // Priority assignment — each order in one bucket, no double-count.
      if (completed && bal > 0) { S.done.v += bal; S.done.ids.push(o.id) }
      else if (sold && paid <= 0 && !completed) { S.dep.v += grand; S.dep.ids.push(o.id) }
      else if (sold && awaiting) { S.appr.v += grand; S.appr.ids.push(o.id) }
      else if (ESTIMATE_STATUSES.includes(o.status) && daysBetween(o.created_at, asOf) >= 7) { S.quote.v += grand; S.quote.ids.push(o.id) }
      else if (completed && bal <= 0 && o.status !== 'closed') { S.close.v += bal; S.close.ids.push(o.id) }
    }
    const segments = [
      { label: 'Unpaid completed jobs', value: S.done.v, ids: S.done.ids, color: '#b54040', count: S.done.ids.length },
      { label: 'Deposits not collected', value: S.dep.v, ids: S.dep.ids, color: '#d2691e', count: S.dep.ids.length },
      { label: 'Awaiting design approval', value: S.appr.v, ids: S.appr.ids, color: '#7c3aed', count: S.appr.ids.length },
      { label: 'Quotes — no follow-up 7+ days', value: S.quote.v, ids: S.quote.ids, color: '#b8842a', count: S.quote.ids.length },
      { label: 'Complete — not closed out', value: S.close.v, ids: S.close.ids, color: '#5d5d5a', count: S.close.ids.length },
    ]
    const total = segments.reduce((s, x) => s + x.value, 0)
    const health = healthFrom(total, { red: 50000, yellow: 15000, invert: true })
    return {
      health, value: total,
      csv: { filename: 'money-at-risk', headers: ['Risk type', 'Amount', 'Count'], rows: segments.map(s => [s.label, Math.round(s.value), s.count]) },
      body: <StackBar segments={segments} onDrill={ctx.onDrill} />,
    }
  },
}

const REVENUE_LIMBO = {
  id: 'revenue_limbo', group: 'money', daily: true,
  title: 'Revenue Stuck in Limbo',
  why: 'How much signed work is parked at each stage — where your cash is frozen.',
  compute(bundle, ctx) {
    const orderById = {}; for (const o of bundle.orders) orderById[o.id] = o
    const acc = {}
    for (const j of bundle.jobs) {
      if (!isActiveJob(j)) continue
      const o = j.order || orderById[j.order_id]
      if (!o || !SOLD_STATUSES.includes(o.status)) continue
      const st = currentStage(j)
      if (st === 'closeout') continue   // not "limbo" — essentially done
      ;(acc[st] ||= { ids: [], v: 0 })
      acc[st].v += rowGrandTotal(o); acc[st].ids.push(j.id)
    }
    const buckets = STAGE_ORDER.filter(s => acc[s]).map(s => ({
      label: STAGE_LABEL[s], value: acc[s].v, count: acc[s].ids.length, ids: acc[s].ids, color: STAGE_COLOR[s], kind: 'jobs', drillTitle: `${STAGE_LABEL[s]} stage`,
    }))
    const total = buckets.reduce((s, b) => s + b.value, 0)
    const health = total === 0 ? 'green' : healthFrom(total, { red: 150000, yellow: 60000, invert: true })
    if (!buckets.length) return { health: 'green', value: 0, body: <div className="rb-empty">No signed work parked in a stage right now.</div> }
    return {
      health, value: total,
      csv: { filename: 'revenue-in-limbo', headers: ['Stage', 'Amount', 'Jobs'], rows: buckets.map(b => [b.label, Math.round(b.value), b.count]) },
      body: <BucketBars buckets={buckets} total={total} onDrill={ctx.onDrill} />,
    }
  },
}

const BOTTLENECK_RADAR = {
  id: 'bottleneck_radar', group: 'operations', daily: true,
  title: 'Bottleneck Radar',
  why: 'Which stage is clogged — count, dollars, and how long jobs have sat there.',
  compute(bundle, ctx) {
    const asOf = ctx.range.end.getTime()
    const orderById = {}; for (const o of bundle.orders) orderById[o.id] = o
    const acc = {}
    for (const j of bundle.jobs) {
      if (!isActiveJob(j)) continue
      const o = j.order || orderById[j.order_id]
      const st = currentStage(j)
      ;(acc[st] ||= { ids: [], v: 0, ages: [] })
      acc[st].v += o ? rowGrandTotal(o) : 0
      acc[st].ids.push(j.id)
      acc[st].ages.push(daysBetween(j.last_update_at || j.created_at, asOf))
    }
    const rows = STAGE_ORDER.filter(s => acc[s]).map(s => {
      const a = acc[s]
      const avg = a.ages.length ? Math.round(a.ages.reduce((x, y) => x + y, 0) / a.ages.length) : 0
      return { stage: s, label: STAGE_LABEL[s], count: a.ids.length, value: a.v, ids: a.ids, avgDays: avg, oldest: a.ages.length ? Math.max(...a.ages) : 0 }
    }).sort((x, y) => y.avgDays - x.avgDays)
    const worstAvg = rows.length ? rows[0].avgDays : 0
    const health = healthFrom(worstAvg, { red: 21, yellow: 10, invert: true })
    return {
      health, value: worstAvg,
      csv: { filename: 'bottleneck-radar', headers: ['Stage', 'Jobs', '$ in stage', 'Avg days', 'Oldest days'], rows: rows.map(r => [r.label, r.count, Math.round(r.value), r.avgDays, r.oldest]) },
      body: <StageTable rows={rows} onDrill={ctx.onDrill} />,
    }
  },
}

const CUSTOMER_WAITING = {
  id: 'customer_waiting', group: 'customers', daily: true,
  title: 'Customer Waiting',
  why: 'Who’s waiting on us, for what — and who hasn’t heard from us in a week.',
  compute(bundle, ctx) {
    const asOf = ctx.range.end.getTime()
    const orderById = {}; for (const o of bundle.orders) orderById[o.id] = o
    const B = { approval: { ids: [], v: 0 }, info: { ids: [], v: 0 }, payment: { ids: [], v: 0 }, install: { ids: [], v: 0 } }
    let noContact = 0
    for (const j of bundle.jobs) {
      if (!isActiveJob(j)) continue
      const o = j.order || orderById[j.order_id]
      if (!o) continue
      const grand = rowGrandTotal(o)
      // What the customer is waiting on US for (their next-touch driver).
      let bucket = null
      if (msDone(j, 'proof_sent') && !msDone(j, 'proof_approved')) bucket = 'approval'
      else if (j.overall_status === 'waiting_on_customer') bucket = 'info'
      else if (SOLD_STATUSES.includes(o.status) && rowBalanceDue(o) > 0 && (msDone(j, 'installed') || ['installed', 'closed', 'paid_in_full'].includes(o.status))) bucket = 'payment'
      else if (msDone(j, 'ready_to_install') && !msDone(j, 'installed')) bucket = 'install'
      if (!bucket) continue
      B[bucket].v += grand; B[bucket].ids.push(o.id)
      if (daysBetween(j.last_update_at || j.created_at, asOf) >= 7) noContact++
    }
    const buckets = [
      { label: 'Awaiting our proof / approval', value: B.approval.v, count: B.approval.ids.length, ids: B.approval.ids, color: '#7c3aed' },
      { label: 'Waiting on us for info / next step', value: B.info.v, count: B.info.ids.length, ids: B.info.ids, color: '#b8842a' },
      { label: 'Final payment due (their move)', value: B.payment.v, count: B.payment.ids.length, ids: B.payment.ids, color: '#1d4ed8' },
      { label: 'Stone ready — awaiting install', value: B.install.v, count: B.install.ids.length, ids: B.install.ids, color: '#1D9E75' },
    ]
    const total = buckets.reduce((s, b) => s + b.count, 0)
    const health = noContact === 0 ? 'green' : healthFrom(noContact, { red: 5, yellow: 2, invert: true })
    if (total === 0) return { health: 'green', value: 0, body: <div className="rb-empty">No customers waiting on us right now.</div> }
    return {
      health, value: noContact,
      note: null,
      csv: { filename: 'customer-waiting', headers: ['Waiting for', '$ value', 'Customers'], rows: buckets.map(b => [b.label, Math.round(b.value), b.count]) },
      body: (
        <>
          <BucketBars buckets={buckets.map(b => ({ ...b, drillTitle: b.label }))} onDrill={ctx.onDrill} />
          {noContact > 0 && <div className="rb-flag">⚠ {noContact} {noContact === 1 ? 'customer hasn’t' : 'customers haven’t'} heard from us in 7+ days (last job activity). Last-contact isn’t tracked directly yet — this uses last job update as a proxy.</div>}
        </>
      ),
    }
  },
}

const OVERDUE_HEATMAP = {
  id: 'overdue_heatmap', group: 'operations', daily: true,
  title: 'Overdue Work Heatmap',
  why: 'Late work by type and how late — so the worst-aged items jump out.',
  compute() {
    // Honest "not yet tracked": a work-type × lateness grid needs per-milestone
    // DUE DATES, which are populated on well under 1% of milestones today. With
    // no due dates there's nothing to age against — rendering buckets would be
    // fabricated zeros. Flag for a capture field instead.
    return {
      health: 'neutral',
      note: 'Not yet tracked. This grid needs a due date on each milestone (design due, permit due, foundation due, install due, closeout due). Those fields exist but are essentially never filled in today, so there’s nothing to age against. Add a capture step that sets milestone due dates and this lights up.',
    }
  },
}

const JOB_TYPE_LABEL = { new_stone: 'New stone', inscription: 'Inscription', cleaning_repair: 'Cleaning / repair', mausoleum_door: 'Mausoleum door', bronze: 'Bronze', civic_memorial: 'Civic memorial' }
const jobTypeLabel = (t) => JOB_TYPE_LABEL[t] || (t ? t.replace(/_/g, ' ') : 'Other')

// Job start→finish window in days (signed/created → installed status_date, else
// now for active jobs). status_date is sparsely populated, so finish often falls
// back to last activity — disclosed where it affects a headline number.
function jobDays(j, nowMs) {
  const startMs = new Date(j?.order?.signed_at || j?.order?.created_at || j?.created_at || 0).getTime()
  const finIso = msDate(j, 'installed')
  const finMs = finIso ? new Date(finIso).getTime() : (isActiveJob(j) ? nowMs : new Date(j?.last_update_at || j?.created_at || 0).getTime())
  return Math.max(0, Math.floor((finMs - startMs) / 86400000))
}

const TRUE_PROFIT_JOB = {
  id: 'true_profit_job', group: 'money', daily: false,
  title: 'True Profit by Job',
  why: 'Sale minus real logged costs, per job — plus profit earned per day in process.',
  compute(bundle, ctx) {
    const nowMs = ctx.range.end.getTime()
    const { byOrder } = outgoingByOrder(bundle.outgoing)
    const rows = []
    let anyCost = false
    for (const j of bundle.jobs) {
      const o = j.order; if (!o) continue
      const sale = rowGrandTotal(o)
      const cost = byOrder[o.id] || 0
      if (sale <= 0 && cost <= 0) continue
      if (cost > 0) anyCost = true
      const gross = sale - cost
      const margin = sale > 0 ? Math.round((gross / sale) * 100) : null
      const days = Math.max(1, jobDays(j, nowMs))
      rows.push({ _id: j.id, _kind: 'jobs', _drillTitle: jobName(j), name: jobName(j), sale, cost, gross, margin: margin == null ? -1 : margin, perDay: Math.round(gross / days), days })
    }
    if (!rows.length) return { health: 'neutral', note: 'No jobs with a sale price or logged cost yet.' }
    const margins = rows.map(r => r.margin).filter(m => m >= 0).sort((a, b) => a - b)
    const med = margins.length ? margins[Math.floor(margins.length / 2)] : null
    const columns = [
      { key: 'name', label: 'Job' },
      { key: 'sale', label: 'Sale', num: true, fmt: v => fmtUSD(v) },
      { key: 'cost', label: 'Cost', num: true, fmt: v => fmtUSD(v) },
      { key: 'gross', label: 'Gross', num: true, fmt: v => fmtUSD(v) },
      { key: 'margin', label: 'Margin', num: true, fmt: v => v < 0 ? '—' : `${v}%` },
      { key: 'perDay', label: '$/day', num: true, fmt: v => fmtUSD(v) },
    ]
    return {
      health: med == null ? 'neutral' : healthFrom(med, { red: 20, yellow: 35 }), value: med,
      csv: { filename: 'true-profit-by-job', headers: ['Job', 'Sale', 'Cost', 'Gross', 'Margin%', '$/day', 'Days'], rows: rows.map(r => [r.name, Math.round(r.sale), Math.round(r.cost), Math.round(r.gross), r.margin < 0 ? '' : r.margin, r.perDay, r.days]) },
      body: (
        <>
          <SortableTable columns={columns} rows={rows} grid="1.4fr 86px 78px 86px 66px 78px" initialSort={{ key: 'perDay', dir: 'desc' }} onDrill={ctx.onDrill} />
          {!anyCost && <div className="rb-flag">No order-linked costs logged yet, so Cost is $0 and margin reads 100% everywhere. Log supplier / permit / vendor spend against orders (Payments → Outgoing, “link to order”) and this fills in. Labor cost isn’t captured, so it’s intentionally omitted.</div>}
        </>
      ),
    }
  },
}

const PROFIT_JOB_TYPE = {
  id: 'profit_job_type', group: 'money', daily: false,
  title: 'Profit by Job Type',
  why: 'Which kinds of work actually pay — revenue, avg profit, margin, and cycle time by type.',
  compute(bundle, ctx) {
    const nowMs = ctx.range.end.getTime()
    const { byOrder } = outgoingByOrder(bundle.outgoing)
    const acc = {}
    for (const j of bundle.jobs) {
      const o = j.order; if (!o) continue
      const t = j.job_type || 'other'
      ;(acc[t] ||= { ids: [], rev: 0, cost: 0, cycles: [], n: 0 })
      acc[t].rev += rowGrandTotal(o); acc[t].cost += (byOrder[o.id] || 0); acc[t].n++
      acc[t].ids.push(j.id); acc[t].cycles.push(jobDays(j, nowMs))
    }
    const rows = Object.entries(acc).map(([t, a]) => {
      const profit = a.rev - a.cost
      return {
        _id: t, _ids: a.ids, _kind: 'jobs', _drillTitle: jobTypeLabel(t),
        type: jobTypeLabel(t), revenue: a.rev, avgProfit: Math.round(profit / a.n),
        margin: a.rev > 0 ? Math.round((profit / a.rev) * 100) : -1,
        avgCycle: a.cycles.length ? Math.round(a.cycles.reduce((x, y) => x + y, 0) / a.cycles.length) : 0, n: a.n,
      }
    })
    if (!rows.length) return { health: 'neutral', note: 'No jobs to summarize yet.' }
    const columns = [
      { key: 'type', label: 'Type' }, { key: 'n', label: 'Jobs', num: true },
      { key: 'revenue', label: 'Revenue', num: true, fmt: v => fmtUSD(v) },
      { key: 'avgProfit', label: 'Avg profit', num: true, fmt: v => fmtUSD(v) },
      { key: 'margin', label: 'Margin', num: true, fmt: v => v < 0 ? '—' : `${v}%` },
      { key: 'avgCycle', label: 'Avg days', num: true, fmt: v => `${v}d` },
    ]
    return {
      health: 'neutral', value: rows.reduce((s, r) => s + r.revenue, 0),
      csv: { filename: 'profit-by-job-type', headers: ['Type', 'Jobs', 'Revenue', 'Avg profit', 'Margin%', 'Avg cycle days'], rows: rows.map(r => [r.type, r.n, Math.round(r.revenue), r.avgProfit, r.margin < 0 ? '' : r.margin, r.avgCycle]) },
      body: <SortableTable columns={columns} rows={rows} grid="1.2fr 56px 96px 96px 70px 72px" initialSort={{ key: 'revenue', dir: 'desc' }} onDrill={ctx.onDrill} />,
    }
  },
}

const CEMETERY_PROFIT = {
  id: 'cemetery_profit', group: 'cemeteries', daily: false,
  title: 'Cemetery Profitability',
  why: 'Which cemeteries are worth the trip — jobs, revenue, profit, and timelines.',
  compute(bundle, ctx) {
    const { byOrder } = outgoingByOrder(bundle.outgoing)
    const acc = {}
    let anyPermit = false, anyInstall = false
    for (const j of bundle.jobs) {
      const o = j.order; if (!o) continue
      const cem = o.cemetery?.name || '—'
      ;(acc[cem] ||= { ids: [], rev: 0, cost: 0, n: 0, permit: [], o2i: [] })
      acc[cem].rev += rowGrandTotal(o); acc[cem].cost += (byOrder[o.id] || 0); acc[cem].n++; acc[cem].ids.push(j.id)
      const pf = msDate(j, 'permit_filed'), pa = msDate(j, 'permit_approved')
      if (pf && pa) { acc[cem].permit.push(Math.max(0, Math.floor((new Date(pa) - new Date(pf)) / 86400000))); anyPermit = true }
      const inst = msDate(j, 'installed')
      if (inst && o.signed_at) { acc[cem].o2i.push(Math.max(0, Math.floor((new Date(inst) - new Date(o.signed_at)) / 86400000))); anyInstall = true }
    }
    const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null
    const rows = Object.entries(acc).map(([cem, a]) => {
      const profit = a.rev - a.cost
      return {
        _id: cem, _ids: a.ids, _kind: 'jobs', _drillTitle: cem,
        cemetery: cem, n: a.n, revenue: a.rev, profit, margin: a.rev > 0 ? Math.round((profit / a.rev) * 100) : -1,
        permitDays: avg(a.permit), installDays: avg(a.o2i),
      }
    })
    if (!rows.length) return { health: 'neutral', note: 'No jobs tied to a cemetery yet.' }
    const columns = [
      { key: 'cemetery', label: 'Cemetery' }, { key: 'n', label: 'Jobs', num: true },
      { key: 'revenue', label: 'Revenue', num: true, fmt: v => fmtUSD(v) },
      { key: 'profit', label: 'Profit', num: true, fmt: v => fmtUSD(v) },
      { key: 'margin', label: 'Margin', num: true, fmt: v => v < 0 ? '—' : `${v}%` },
      { key: 'permitDays', label: 'Permit d', num: true, fmt: v => v == null ? '—' : `${v}d` },
      { key: 'installDays', label: 'Order→install', num: true, fmt: v => v == null ? '—' : `${v}d` },
    ]
    return {
      health: 'neutral', value: rows.reduce((s, r) => s + r.profit, 0),
      csv: { filename: 'cemetery-profitability', headers: ['Cemetery', 'Jobs', 'Revenue', 'Profit', 'Margin%', 'Avg permit days', 'Avg order-to-install days'], rows: rows.map(r => [r.cemetery, r.n, Math.round(r.revenue), Math.round(r.profit), r.margin < 0 ? '' : r.margin, r.permitDays ?? '', r.installDays ?? '']) },
      body: (
        <>
          <SortableTable columns={columns} rows={rows} grid="1.3fr 50px 90px 88px 64px 70px 96px" initialSort={{ key: 'profit', dir: 'desc' }} onDrill={ctx.onDrill} />
          {(!anyPermit || !anyInstall) && <div className="rb-flag">Permit-days / order-to-install columns are blank where the milestone timestamps (status_date) weren’t recorded — those are sparsely captured today, so the timing columns fill in only as jobs flow through with dated milestones.</div>}
        </>
      ),
    }
  },
}

const STUCK_JOBS = {
  id: 'stuck_jobs', group: 'operations', daily: false,
  title: 'Stuck Jobs',
  why: 'Jobs with no movement lately — and whether the ball is in our court or theirs.',
  compute(bundle, ctx) {
    const nowMs = ctx.range.end.getTime()
    const defs = [
      { key: '3', label: '3–6 days', lo: 3, hi: 6, color: '#b8842a' },
      { key: '7', label: '7–13 days', lo: 7, hi: 13, color: '#d2691e' },
      { key: '14', label: '14–29 days', lo: 14, hi: 29, color: '#c0501e' },
      { key: '30', label: '30+ days', lo: 30, hi: Infinity, color: '#b54040' },
    ]
    const acc = {}; defs.forEach(d => acc[d.key] = { ids: [], v: 0 })
    let internal = 0, customer = 0
    for (const j of bundle.jobs) {
      if (!isActiveJob(j)) continue
      const days = daysBetween(j.last_update_at || j.created_at, nowMs)
      if (days < 3) continue
      const d = defs.find(x => days >= x.lo && days <= x.hi); if (!d) continue
      const o = j.order
      acc[d.key].v += o ? rowGrandTotal(o) : 0; acc[d.key].ids.push(j.id)
      const awaitingCust = (msDone(j, 'proof_sent') && !msDone(j, 'proof_approved')) || j.overall_status === 'waiting_on_customer' || (o && rowBalanceDue(o) > 0 && (msDone(j, 'installed') || ['installed', 'closed'].includes(o.status)))
      if (awaitingCust) customer++; else internal++
    }
    const buckets = defs.map(d => ({ label: d.label, value: acc[d.key].v, count: acc[d.key].ids.length, ids: acc[d.key].ids, color: d.color, kind: 'jobs', drillTitle: `Stuck · ${d.label}` }))
    const total = buckets.reduce((s, b) => s + b.count, 0)
    const over14 = acc['14'].ids.length + acc['30'].ids.length
    const health = total === 0 ? 'green' : healthFrom(over14, { red: 8, yellow: 3, invert: true })
    if (total === 0) return { health: 'green', value: 0, body: <div className="rb-empty">Nothing stuck — every active job has moved in the last 3 days.</div> }
    return {
      health, value: over14,
      csv: { filename: 'stuck-jobs', headers: ['No-movement bucket', '$ value', 'Jobs'], rows: buckets.map(b => [b.label, Math.round(b.value), b.count]) },
      body: (
        <>
          <BucketBars buckets={buckets} onDrill={ctx.onDrill} />
          <div className="rb-split"><strong>{internal}</strong> waiting on us · <strong>{customer}</strong> waiting on the customer</div>
        </>
      ),
    }
  },
}

const CYCLE_TIME_STAGE = {
  id: 'cycle_time_stage', group: 'operations', daily: false,
  title: 'Cycle Time by Stage',
  why: 'Average days each stage takes, by job type — and the single biggest delay.',
  compute() {
    // Honest "not yet tracked": per-stage transition timing needs milestone
    // status_date (when each milestone completed). That's populated on roughly
    // 3% of milestones today, so stage-to-stage durations can't be computed
    // without fabricating. The cascade now stamps status_date going forward, so
    // this becomes real as jobs flow through — flag a backfill / capture.
    return {
      health: 'neutral',
      note: 'Not yet tracked. Per-stage durations need a completion timestamp (status_date) on each milestone — currently filled on only ~3% of milestones, so there’s not enough to average. New completions now stamp it, so this earns out over time (a backfill would speed it up).',
    }
  },
}

const INSTALL_EFFICIENCY = {
  id: 'install_efficiency', group: 'operations', daily: false,
  title: 'Install Efficiency',
  why: 'What each field trip delivers — installs, revenue, and profit per run.',
  compute(bundle, ctx) {
    const jobById = {}; for (const j of bundle.jobs) jobById[j.id] = j
    const { byOrder } = outgoingByOrder(bundle.outgoing)
    const INSTALL_KINDS = new Set(['setting', 'delivery'])
    const trips = (bundle.batches || []).filter(b => b.scheduled_date && b.status !== 'cancelled' && INSTALL_KINDS.has(b.kind))
    if (!trips.length) return { health: 'neutral', note: 'No scheduled install/delivery trips yet — once setting or delivery batches are scheduled, this fills in. (Mileage / route-waste is deferred — no distance data captured yet.)' }
    let totalInstalls = 0, totalRev = 0, totalCost = 0
    const jobIds = []
    for (const b of trips) {
      const stops = b.batch_jobs || []
      totalInstalls += stops.length
      for (const s of stops) {
        const o = jobById[s.job_id]?.order
        if (o) { totalRev += rowGrandTotal(o); totalCost += (byOrder[o.id] || 0); jobIds.push(s.job_id) }
      }
    }
    const n = trips.length
    const profit = totalRev - totalCost
    const installsPerTrip = totalInstalls / n
    const stats = [
      { label: 'Trips', value: n, fmt: v => String(v) },
      { label: 'Installs / trip', value: installsPerTrip, fmt: v => v.toFixed(1) },
      { label: 'Revenue / trip', value: totalRev / n, fmt: v => fmtUSD(v) },
      { label: 'Profit / trip', value: profit / n, fmt: v => fmtUSD(v) },
    ]
    return {
      health: healthFrom(installsPerTrip, { red: 1, yellow: 1.5 }), value: installsPerTrip,
      csv: { filename: 'install-efficiency', headers: ['Trips', 'Total installs', 'Installs/trip', 'Total revenue', 'Revenue/trip', 'Total profit', 'Profit/trip'], rows: [[n, totalInstalls, installsPerTrip.toFixed(2), Math.round(totalRev), Math.round(totalRev / n), Math.round(profit), Math.round(profit / n)]] },
      body: (
        <>
          <StatGrid stats={stats} onClick={() => ctx.onDrill({ title: 'Jobs on install/delivery trips', ids: jobIds, kind: 'jobs' })} />
          <div className="rb-split">Profit/trip uses order-linked costs only (labor + mileage not captured). Multiple installs per trip = a more efficient run.</div>
        </>
      ),
    }
  },
}

// Registry. (Daily Command = those with daily:true; Library = all, grouped.)
export const REPORTS = [
  MONEY_AT_RISK,
  REVENUE_LIMBO,
  OPEN_QUOTES_AGE,
  RECEIVABLES_AGING,
  BOTTLENECK_RADAR,
  OVERDUE_HEATMAP,
  CUSTOMER_WAITING,
  TRUE_PROFIT_JOB,
  PROFIT_JOB_TYPE,
  CEMETERY_PROFIT,
  STUCK_JOBS,
  CYCLE_TIME_STAGE,
  INSTALL_EFFICIENCY,
]

export const REPORTS_BY_ID = Object.fromEntries(REPORTS.map(r => [r.id, r]))
