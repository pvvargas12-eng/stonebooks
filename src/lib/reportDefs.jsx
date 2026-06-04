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
  rowGrandTotal, rowBalanceDue, rowTotalPaid, fmtUSD, SOLD_STATUSES,
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

// Registry. (Daily Command = those with daily:true; Library = all, grouped.)
export const REPORTS = [
  MONEY_AT_RISK,
  REVENUE_LIMBO,
  OPEN_QUOTES_AGE,
  RECEIVABLES_AGING,
  BOTTLENECK_RADAR,
  OVERDUE_HEATMAP,
  CUSTOMER_WAITING,
]

export const REPORTS_BY_ID = Object.fromEntries(REPORTS.map(r => [r.id, r]))
