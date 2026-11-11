// =============================================================================
// ShopPulse — the Dashboard / daily report (SHOP-PULSE, Paul 2026-11-10)
// =============================================================================
// Built from the approved mockup (artifact 9HP28jt6kewEwLQiRZxx9X): what came
// in, what got sold, what got done, and what needs a hand — for today, this
// week, month, quarter or year. It replaces the dark Inventory "command
// center" AND the Reports "Daily Command" card wall, so there is ONE daily
// page. READ-ONLY: every number is derived at read time from the truths that
// already run the shop; nothing is stored.
//   Money in      — locked, non-voided orders.payments[] by the day received
//   Sales made    — orders by signed_at (cancelled out), contract value
//   Work done     — job milestones by their own status_date:
//                   blasted (production_completed on new-stone jobs),
//                   installed (installed / door_installed / work_completed),
//                   inscriptions (inscription_completed), bronzes set
//   Needs a hand  — live counts off the job status ladders, each row links out
//   Money on the table — the Collect balances queues (lib/collections), each
//                   order once under its top queue, so the three rows add up
//   Pipeline      — open new-stone jobs by where the stone stands
//   Line graphs   — the last 12 weeks, Monday weeks
// Cemetery-order payments live in a different ledger (financial_records) and
// are NOT in Money in yet; the page says so.
// =============================================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  rowGrandTotal, rowBalanceDue, rowMoneyDown, rowNonVoidedPayments, fmtUSD, properName, customerName,
  deriveDesignStatus, deriveStoneStatus, deriveFdnStatus, statusDimApplies, getInstallList, getFoundationList,
} from '../lib/stonebooksData'
import { loadReportsData } from '../lib/reportsData'
import { getCollectionQueues, STAGES } from '../lib/collections'
import { openPrintSheet } from '../lib/weekPrintSheet'

const DAY = 86400000
const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const LEAD = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL = new Set(['closed', 'cancelled'])
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const METHOD = { cash: 'cash', check: 'check', card: 'card', credit_card: 'card', zelle: 'Zelle', ach: 'ACH', bank_transfer: 'ACH', other: 'other' }
const PERIODS = [
  { code: 'day', label: 'Today' }, { code: 'week', label: 'This week' }, { code: 'month', label: 'Month' },
  { code: 'quarter', label: 'Quarter' }, { code: 'year', label: 'Year' },
]

// A bare YYYY-MM-DD is a LOCAL day (new Date('2026-10-03') is UTC midnight =
// the evening before in New Jersey), so it is read at noon.
const asDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(`${v}T12:00:00`) : new Date(v)
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const monday = (d) => { const x = sod(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shortDay = (v) => { const d = asDate(v); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

// The picked period and the stretch it is compared with: the SAME POINT in the
// period before (a week on Wednesday compares with last week through
// Wednesday), so a part-way period never reads as "down". Today compares with
// all of yesterday.
function periodRange(code, now) {
  const today = sod(now)
  const endToday = new Date(today.getTime() + DAY)
  let start, prevStart, name, prevName
  if (code === 'day') {
    start = today; prevStart = new Date(today.getTime() - DAY)
    return { start, end: endToday, prevStart, prevEnd: start, name: 'today', prevName: 'yesterday', title: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }
  }
  if (code === 'week') {
    start = monday(now); prevStart = new Date(start.getTime() - 7 * DAY)
    name = 'this week'; prevName = 'the same point last week'
  } else if (code === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1); prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    name = MONTHS[now.getMonth()]; prevName = `the same point in ${MONTHS[prevStart.getMonth()]}`
  } else if (code === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    start = new Date(now.getFullYear(), q * 3, 1); prevStart = new Date(now.getFullYear(), q * 3 - 3, 1)
    name = `Q${q + 1}`; prevName = 'the same point last quarter'
  } else {
    start = new Date(now.getFullYear(), 0, 1); prevStart = new Date(now.getFullYear() - 1, 0, 1)
    name = String(now.getFullYear()); prevName = `the same point in ${now.getFullYear() - 1}`
  }
  const elapsed = endToday.getTime() - start.getTime()
  const prevEnd = new Date(Math.min(start.getTime(), prevStart.getTime() + elapsed))
  const title = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return { start, end: endToday, prevStart, prevEnd, name, prevName, title }
}
const within = (v, a, b) => { if (!v) return false; const t = asDate(v).getTime(); return t >= a.getTime() && t < b.getTime() }

const famOf = (o) => {
  const last = String(o?.primary_lastname || '').trim()
  if (last) return properName(last)
  const cn = customerName(o?.customer)
  return cn && cn !== '—' ? properName(cn) : (o?.order_number || 'Order')
}
const kindOf = (o) => {
  const st = Array.isArray(o?.service_types) ? o.service_types : []
  if (st.some(s => ['NEW_STONE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'].includes(s))) return 'new stone'
  if (st.includes('BRONZE')) return 'bronze'
  if (st.includes('INSCRIPTION')) return 'inscription'
  return 'other'
}
const payDay = (p) => (p?.receivedAt && String(p.receivedAt).slice(0, 10)) || (p?.createdAt && String(p.createdAt).slice(0, 10)) || null
const msDone = (j, key) => { const m = (j.milestones || []).find(x => x.milestone_key === key && x.status === 'done'); return m ? (m.status_date || null) : null }
const msIsDone = (j, key) => (j.milestones || []).some(x => x.milestone_key === key && x.status === 'done')
const installDate = (j) => INSTALL_KEYS.map(k => msDone(j, k)).find(Boolean) || null
const isInstalled = (j) => INSTALL_KEYS.some(k => msIsDone(j, k))
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`

// Every dated event the page counts, built once: payments, signed orders,
// finished work. Period tiles, the lists and the weekly graphs all read these.
function buildEvents(orders, jobs) {
  const payments = [], sales = [], work = []
  for (const o of orders) {
    if (o.archived) continue
    for (const p of rowNonVoidedPayments(o)) {
      const day = payDay(p), amount = Number(p.amount) || 0
      if (!day || amount <= 0) continue
      payments.push({ day, amount, method: METHOD[String(p.method || '').toLowerCase()] || 'other', name: famOf(o), orderNo: o.order_number || '', orderId: o.id })
    }
    if (o.signed_at && o.status !== 'cancelled') {
      sales.push({ day: o.signed_at, total: rowGrandTotal(o) || 0, kind: kindOf(o), name: famOf(o), orderNo: o.order_number || '', orderId: o.id })
    }
  }
  for (const j of jobs) {
    const o = j.order || null
    const name = o ? famOf(o) : (j.cemetery_order_id ? 'Cemetery door' : 'Job')
    const base = { name, orderNo: o?.order_number || '', orderId: o?.id || j.order_id || null }
    if (j.job_type === 'inscription') {
      const d = msDone(j, 'inscription_completed') || msDone(j, 'work_completed')
      if (d) work.push({ ...base, day: d, type: 'inscription', what: 'Inscription carved' })
      continue
    }
    const inst = installDate(j)
    if (inst) work.push({ ...base, day: inst, type: j.job_type === 'bronze' ? 'bronze' : 'installed', what: j.job_type === 'bronze' ? 'Bronze set' : j.job_type === 'mausoleum_door' ? 'Door installed' : 'Installed' })
    if (j.job_type === 'new_stone') { const b = msDone(j, 'production_completed'); if (b) work.push({ ...base, day: b, type: 'blasted', what: 'Stone blasted' }) }
  }
  return { payments, sales, work }
}

function tally(ev, a, b) {
  const pay = ev.payments.filter(p => within(p.day, a, b))
  const sal = ev.sales.filter(s => within(s.day, a, b))
  const wrk = ev.work.filter(w => within(w.day, a, b))
  const by = (rows, key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m }, {})
  return {
    pay, sal, wrk,
    money: pay.reduce((s, p) => s + p.amount, 0), payN: pay.length, byMethod: by(pay, 'method'),
    salesN: sal.length, salesUsd: sal.reduce((s, x) => s + x.total, 0), byKind: by(sal, 'kind'),
    workN: wrk.length, byWork: by(wrk, 'type'),
  }
}

// "Up 12% from the same point last week" / "2 fewer than yesterday".
function trendMoney(cur, prev, prevName) {
  if (!prev && !cur) return { text: `Nothing in either stretch`, dir: '' }
  if (!prev) return { text: `${prevName.charAt(0).toUpperCase()}${prevName.slice(1)} had nothing in`, dir: 'up' }
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { text: `Even with ${prevName}`, dir: '' }
  return { text: `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% from ${prevName} (${fmtUSD(prev)})`, dir: pct > 0 ? 'up' : 'down' }
}
function trendCount(cur, prev, prevName) {
  const d = cur - prev
  if (d === 0) return { text: `Same as ${prevName} (${prev})`, dir: '' }
  return { text: `${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} than ${prevName} (${prev})`, dir: d > 0 ? 'up' : 'down' }
}

// ── Line chart: several series, one axis, last 12 weeks ─────────────────────
function PulseLines({ keys, lines, fmt, label }) {
  const [hover, setHover] = useState(null)
  const W = 560, H = 220, L = 50, R = 14, T = 12, B = 30
  const max = Math.max(1, ...lines.flatMap(l => l.values))
  // Four even gridlines on round numbers: the step is the first of 1 / 2 /
  // 2.5 / 5 / 10 (times a power of ten) that covers a quarter of the peak.
  const p10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, max / 4))))
  const step = [1, 2, 2.5, 5, 10].map(m => m * p10).find(v => v >= max / 4 && Number.isInteger(v)) || p10 * 10
  const top = step * 4
  const x = (i) => L + (keys.length > 1 ? i * (W - L - R) / (keys.length - 1) : 0)
  const y = (v) => T + (H - T - B) * (1 - v / top)
  const grid = [0, 1, 2, 3, 4].map(g => top * g / 4)
  return (
    <div className="spl-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {grid.map(g => (
          <g key={g}>
            <line className="spl-grid" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
            <text className="spl-tick" x={L - 6} y={y(g) + 3} textAnchor="end">{fmt(g)}</text>
          </g>
        ))}
        {hover != null && <line className="spl-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} />}
        {lines.map(l => (
          <path key={l.label} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            d={l.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} />
        ))}
        {lines.map(l => l.values.map((v, i) => (
          <circle key={`${l.label}-${i}`} cx={x(i)} cy={y(v)} r={hover === i || i === l.values.length - 1 ? 4 : 2.5} fill={l.color} stroke="#fff" strokeWidth="1.5" />
        )))}
        {keys.map((k, i) => (
          <g key={k.key} onMouseEnter={() => setHover(i)} onMouseMove={() => setHover(i)}>
            <rect x={x(i) - (W - L - R) / keys.length / 2} y={T} width={(W - L - R) / keys.length} height={H - T - B} fill="transparent" />
            {(i % 2 === 1 || i === keys.length - 1) && <text className={`spl-tick${hover === i ? ' on' : ''}`} x={x(i)} y={H - 10} textAnchor="middle">{k.label}</text>}
          </g>
        ))}
      </svg>
      <div className="spl-legend">
        {lines.map(l => <span key={l.label}><i style={{ background: l.color }} />{l.label}{hover != null ? <b> {fmt(l.values[hover])}</b> : null}</span>)}
        <span className="spl-legend-wk">{hover != null ? `week of ${keys[hover].label}` : 'Hover a week for its numbers'}</span>
      </div>
    </div>
  )
}

const money0 = (v) => v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`
const count0 = (v) => String(Math.round(v))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export default function ShopPulse({ bundle: bundleProp = null, onGo = null, onOpenOrder = null, eyebrow = 'Dashboard', defaultPeriod = 'week', actions = null, preload = null }) {
  const [period, setPeriod] = useState(defaultPeriod)
  const [state, setState] = useState({ loading: true, now: null, bundle: null, queues: null, setList: [], fdnList: [], error: null })
  const [openList, setOpenList] = useState(null)   // 'pay' | 'sal' | 'wrk' — the one showing every row

  const load = useCallback(async () => {
    try {
      const [bundle, queues, setList, fdnList] = await Promise.all([
        bundleProp ? Promise.resolve(bundleProp) : loadReportsData(),
        // `preload` = smoke mounts only (sample rows, no reads).
        preload ? Promise.resolve(preload.queues || new Map()) : getCollectionQueues().catch(() => new Map()),
        preload ? Promise.resolve(preload.setList || []) : getInstallList().catch(() => []),
        preload ? Promise.resolve(preload.fdnList || []) : getFoundationList().catch(() => []),
      ])
      // "Now" is stamped here, in the load, never during render (react-hooks/purity).
      setState({ loading: false, now: new Date(), bundle, queues, setList: setList || [], fdnList: fdnList || [], error: null })
    } catch (e) {
      setState(s => ({ ...s, loading: false, now: new Date(), error: String(e?.message || e) }))
    }
  }, [bundleProp, preload])
  useEffect(() => { load() }, [load])

  const { now, bundle, queues, setList, fdnList } = state
  const orders = useMemo(() => bundle?.orders || [], [bundle])
  const jobs = useMemo(() => bundle?.jobs || [], [bundle])
  const events = useMemo(() => buildEvents(orders, jobs), [orders, jobs])

  const range = useMemo(() => (now ? periodRange(period, now) : null), [period, now])
  const cur = useMemo(() => (range ? tally(events, range.start, range.end) : null), [events, range])
  const prev = useMemo(() => (range ? tally(events, range.prevStart, range.prevEnd) : null), [events, range])

  // ── Live shop state (not tied to the period) ──────────────────────────────
  const live = useMemo(() => {
    const active = jobs.filter(j => {
      if (TERMINAL.has(j.overall_status)) return false
      const o = j.order
      if (!o) return false
      if (o.archived || LEAD.has(o.status) || TERMINAL.has(o.status)) return false
      return !!o.signed_at && rowMoneyDown(o)
    })
    const byId = new Map(active.map(j => [j.id, j]))
    const soon = now ? now.getTime() + 14 * DAY : 0
    const dueSoon = (j) => { const d = j.order?.target_completion_date; return !!d && asDate(d).getTime() <= soon }
    let designMake = 0, designDue = 0, designChanges = 0, designWaiting = 0, inscriptions = 0, bronzes = 0
    const pipe = { order: 0, ordered: 0, here: 0, carved: 0, installed: 0 }
    for (const j of active) {
      const done = isInstalled(j)
      if (!done && statusDimApplies('design', j, j.order)) {
        const ds = deriveDesignStatus(j)
        if (ds === 'not_created' || ds === 'need_rub') { designMake++; if (dueSoon(j)) designDue++ }
        else if (ds === 'needs_adjustments') { designMake++; designChanges++; if (dueSoon(j)) designDue++ }
        else if (ds === 'layout_sent') designWaiting++
      }
      if (j.job_type === 'inscription') { if (!msIsDone(j, 'inscription_completed') && !msIsDone(j, 'work_completed')) inscriptions++; continue }
      if (j.job_type === 'bronze') { if (!done && msIsDone(j, 'bronze_received')) bronzes++; continue }
      if (j.job_type === 'new_stone') {
        if (done) { pipe.installed++; continue }
        const ss = deriveStoneStatus(j)
        if (ss === 'not_ordered') pipe.order++
        else if (ss === 'ordered' || ss === 'needs_pickup') pipe.ordered++
        else if (ss === 'blasted') pipe.carved++
        else pipe.here++
      }
    }
    const readySet = (setList || []).filter(r => { const j = byId.get(r.job_id); return j && !isInstalled(j) }).length
    const fdn = (fdnList || []).filter(r => { const j = byId.get(r.job_id); if (!j) return false; const f = deriveFdnStatus(j); return f === 'not_in' || f === 'need_map' || f === 'dug' }).length

    // Money on the table — each order once, under its top queue.
    const table = Object.fromEntries(STAGES.map(s => [s.code, { n: 0, owed: 0, oldest: null }]))
    for (const o of orders) {
      if (o.archived || TERMINAL.has(o.status)) continue
      const q = queues?.get(o.id)
      if (!q?.stage || !table[q.stage]) continue
      const bal = rowBalanceDue(o)
      if (bal <= 0) continue
      const t = table[q.stage]
      t.n++; t.owed += bal
      if (q.stage === 'installed' && q.installedDate && (!t.oldest || q.installedDate < t.oldest)) t.oldest = q.installedDate
    }
    const collect = STAGES.reduce((s, st) => s + table[st.code].owed, 0)
    return { designMake, designDue, designChanges, designWaiting, inscriptions, bronzes, pipe, readySet, fdn, table, collect }
  }, [jobs, orders, queues, setList, fdnList, now])

  // ── Last 12 Monday weeks ──────────────────────────────────────────────────
  const weekly = useMemo(() => {
    if (!now) return null
    const first = new Date(monday(now).getTime() - 11 * 7 * DAY)
    const keys = Array.from({ length: 12 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i * 7); return { key: ymd(d), label: `${d.getMonth() + 1}/${d.getDate()}` } })
    const idx = new Map(keys.map((k, i) => [k.key, i]))
    const zero = () => keys.map(() => 0)
    const s = { money: zero(), sales: zero(), blasted: zero(), installed: zero(), inscription: zero(), bronze: zero() }
    const at = (v) => { const d = asDate(v); return isNaN(d) ? null : idx.get(ymd(monday(d))) }
    for (const p of events.payments) { const i = at(p.day); if (i != null) s.money[i] += p.amount }
    for (const x of events.sales) { const i = at(x.day); if (i != null) s.sales[i] += x.total }
    for (const w of events.work) { const i = at(w.day); if (i != null && s[w.type]) s[w.type][i] += 1 }
    return { keys, s }
  }, [events, now])

  if (state.loading || !now) return <div className="spl"><style>{SPL_CSS}</style><div className="spl-load">Loading the dashboard…</div></div>

  const go = (target) => { if (onGo) onGo(target) }
  const needs = [
    { key: 'design', n: live.designMake, hot: live.designDue > 0, what: 'Designs to make', sub: `no layout yet${live.designChanges ? `, ${live.designChanges} with changes asked` : ''}${live.designDue ? ` · ${live.designDue} due inside 14 days` : ''}`, link: 'Design hub' },
    { key: 'design', n: live.designWaiting, what: 'Designs waiting on the family', sub: 'proof sent, not approved yet', link: 'Design hub' },
    { key: 'needs', n: live.pipe.order, hot: live.pipe.order > 0, what: 'Stones to order', sub: 'new stone sold, stone not ordered yet', link: 'Needs Ordering' },
    { key: 'foundations', n: live.fdn, what: 'Foundations to pour', sub: 'on the dig list, not poured', link: 'Foundations' },
    { key: 'install', n: live.readySet, hot: live.readySet > 0, what: 'Stones ready to install', sub: 'on the install list, not set yet', link: 'Installation' },
    { key: 'production', n: live.inscriptions, what: 'Inscriptions to carve', sub: 'sold, not carved yet', link: 'Production floor' },
    { key: 'install', n: live.bronzes, what: 'Bronzes to set', sub: 'arrived, not set yet', link: 'Installation' },
  ]
  const needsTotal = needs.reduce((s, r) => s + r.n, 0)

  const methodLine = Object.entries(cur.byMethod).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} ${m}`).join(', ')
  const kindLine = ['new stone', 'bronze', 'inscription', 'other'].filter(k => cur.byKind[k]).map(k => `${cur.byKind[k]} ${k}`).join(', ')
  const workLine = [
    cur.byWork.blasted && plural(cur.byWork.blasted, 'stone blasted', 'stones blasted'),
    cur.byWork.installed && `${cur.byWork.installed} installed`,
    cur.byWork.inscription && plural(cur.byWork.inscription, 'inscription'),
    cur.byWork.bronze && plural(cur.byWork.bronze, 'bronze set', 'bronzes set'),
  ].filter(Boolean).join(' · ')
  const tMoney = trendMoney(cur.money, prev.money, range.prevName)
  const tSales = trendCount(cur.salesN, prev.salesN, range.prevName)
  const tWork = trendCount(cur.workN, prev.workN, range.prevName)

  const pipeSegs = [
    { code: 'order', n: live.pipe.order, label: 'Stone to order', short: 'to order', color: '#b8b2a4' },
    { code: 'ordered', n: live.pipe.ordered, label: 'Ordered', short: 'ordered', color: '#8a8276' },
    { code: 'here', n: live.pipe.here, label: 'Stone here', short: 'here', color: '#4a6fa5' },
    { code: 'carved', n: live.pipe.carved, label: 'Carved, waiting on install', short: 'carved', color: '#c9962a' },
    { code: 'installed', n: live.pipe.installed, label: 'Installed, not closed', short: 'installed', color: '#1f7a3d' },
  ]
  const pipeTotal = pipeSegs.reduce((s, x) => s + x.n, 0)
  const pipeDonePct = pipeTotal ? Math.round(((live.pipe.carved + live.pipe.installed) / pipeTotal) * 100) : 0

  const byNewest = (a, b) => asDate(b.day).getTime() - asDate(a.day).getTime()
  const lists = [
    { code: 'pay', title: 'Money in', rows: [...cur.pay].sort(byNewest), right: (r) => fmtUSD(r.amount), mid: (r) => r.method },
    { code: 'sal', title: 'Sales signed', rows: [...cur.sal].sort(byNewest), right: (r) => fmtUSD(r.total), mid: (r) => r.kind },
    { code: 'wrk', title: 'Work done', rows: [...cur.wrk].sort(byNewest), right: () => '', mid: (r) => r.what },
  ]

  const printReport = () => {
    const sec = (title, rows, cols) => rows.length
      ? `<h2>${esc(title)} (${rows.length})</h2><table>${rows.map(r => `<tr>${cols.map((c, i) => `<td class="${i === cols.length - 1 ? 'r' : ''}">${esc(c(r))}</td>`).join('')}</tr>`).join('')}</table>`
      : `<h2>${esc(title)}</h2><p class="m">None in this period.</p>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shop report ${esc(range.title)}</title><style>
      @page { size: letter portrait; margin: 14mm; } * { box-sizing: border-box; }
      body { font: 12px 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 2px; } .m { color: #555; margin: 0 0 10px; }
      h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #111; padding-bottom: 3px; margin: 16px 0 6px; }
      .t { display: flex; gap: 10px; } .t div { flex: 1; border: 1px solid #111; padding: 8px 10px; } .t b { display: block; font-size: 18px; font-family: Consolas, monospace; } .t small { color: #555; }
      table { width: 100%; border-collapse: collapse; } td { padding: 3px 4px; border-bottom: 1px solid #ccc; vertical-align: top; overflow-wrap: anywhere; } td.r { text-align: right; white-space: nowrap; font-family: Consolas, monospace; }
    </style></head><body>
      <h1>Shop report: ${esc(PERIODS.find(p => p.code === period)?.label || '')}</h1>
      <p class="m">${esc(range.title)} · printed ${esc(now.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
      <div class="t">
        <div><small>MONEY IN</small><b>${esc(fmtUSD(cur.money))}</b><small>${esc(plural(cur.payN, 'payment'))}. ${esc(tMoney.text)}</small></div>
        <div><small>SALES MADE</small><b>${cur.salesN}</b><small>${esc(fmtUSD(cur.salesUsd))} signed. ${esc(tSales.text)}</small></div>
        <div><small>WORK DONE</small><b>${cur.workN}</b><small>${esc(workLine || 'nothing marked done')}. ${esc(tWork.text)}</small></div>
      </div>
      <h2>Needs a hand (${needsTotal})</h2>
      <table>${needs.map(r => `<tr><td>${esc(r.what)}: ${esc(r.sub)}</td><td class="r">${r.n}</td></tr>`).join('')}</table>
      <h2>Money on the table</h2>
      <table>${STAGES.map(s => `<tr><td>${esc(s.label)} (${live.table[s.code].n})</td><td class="r">${esc(fmtUSD(live.table[s.code].owed))}</td></tr>`).join('')}<tr><td><b>Collect now</b></td><td class="r"><b>${esc(fmtUSD(live.collect))}</b></td></tr></table>
      ${sec('Money in', lists[0].rows, [r => shortDay(r.day), r => `${r.name} ${r.orderNo}`, r => r.method, r => fmtUSD(r.amount)])}
      ${sec('Sales signed', lists[1].rows, [r => shortDay(r.day), r => `${r.name} ${r.orderNo}`, r => r.kind, r => fmtUSD(r.total)])}
      ${sec('Work done', lists[2].rows, [r => shortDay(r.day), r => `${r.name} ${r.orderNo}`, r => r.what])}
    </body></html>`
    openPrintSheet(html)
  }

  return (
    <div className="spl">
      <style>{SPL_CSS}</style>
      <div className="spl-head">
        <div className="spl-head-l">
          <div className="spl-eyebrow">{eyebrow}</div>
          <h1 className="spl-h1">Shop Pulse</h1>
          <p className="spl-lede">What came in, what got sold, what got done, and what needs a hand. {range.title}.</p>
        </div>
        <div className="spl-head-r">
          <div className="spl-chips">
            {PERIODS.map(p => <button key={p.code} type="button" className={`spl-chip${period === p.code ? ' on' : ''}`} onClick={() => { setPeriod(p.code); setOpenList(null) }}>{p.label}</button>)}
          </div>
          <div className="spl-acts">
            {actions}
            <button type="button" className="spl-btn" onClick={printReport}>Print this report</button>
            <button type="button" className="spl-btn" onClick={() => { setState(s => ({ ...s, loading: true })); load() }}>Refresh</button>
          </div>
        </div>
      </div>
      {state.error && <div className="spl-err">Some numbers could not load: {state.error}</div>}

      <div className="spl-tiles">
        <div className="spl-tile">
          <div className="spl-lab">Money in</div>
          <div className="spl-big">{fmtUSD(cur.money)}</div>
          <div className="spl-sub">{cur.payN ? `${plural(cur.payN, 'payment')} · ${methodLine}` : 'No payments recorded'}</div>
          <div className={`spl-trend ${tMoney.dir}`}>{tMoney.dir === 'up' ? '▲ ' : tMoney.dir === 'down' ? '▼ ' : ''}{tMoney.text}</div>
        </div>
        <div className="spl-tile">
          <div className="spl-lab">Sales made</div>
          <div className="spl-big">{cur.salesN}</div>
          <div className="spl-sub">{cur.salesN ? `${fmtUSD(cur.salesUsd)} signed · ${kindLine}` : 'No contracts signed'}</div>
          <div className={`spl-trend ${tSales.dir}`}>{tSales.dir === 'up' ? '▲ ' : tSales.dir === 'down' ? '▼ ' : ''}{tSales.text}</div>
        </div>
        <div className="spl-tile">
          <div className="spl-lab">Work done</div>
          <div className="spl-big">{cur.workN}</div>
          <div className="spl-sub">{workLine || 'Nothing marked done'}</div>
          <div className={`spl-trend ${tWork.dir}`}>{tWork.dir === 'up' ? '▲ ' : tWork.dir === 'down' ? '▼ ' : ''}{tWork.text}</div>
        </div>
      </div>

      <div className="spl-cols">
        <div className="spl-panel">
          <h2>Needs a hand <span className="spl-n">{needsTotal}</span></h2>
          <div className="spl-rows">
            {needs.map((r, i) => (
              <button type="button" key={i} className={`spl-row${r.hot ? ' hot' : ''}`} onClick={() => go(r.key)} disabled={!onGo}>
                <span className="spl-what">{r.what}<small>{r.sub}</small></span>
                <span className="spl-cnt">{r.n}</span>
                <span className="spl-go">{r.link} →</span>
              </button>
            ))}
          </div>
        </div>

        <div className="spl-panel spl-money">
          <h2>Money on the table</h2>
          <div className="spl-rows">
            {STAGES.map(s => {
              const t = live.table[s.code]
              const oldDays = t.oldest ? Math.max(0, Math.floor((sod(now).getTime() - asDate(t.oldest).getTime()) / DAY)) : null
              return (
                <button type="button" key={s.code} className="spl-row" onClick={() => go('collect')} disabled={!onGo}>
                  <span className="spl-what">{s.label}<small>{plural(t.n, 'order')} · {s.sub}{oldDays != null ? ` · oldest set ${oldDays} days ago` : ''}</small></span>
                  <span className="spl-amt">{fmtUSD(t.owed)}</span>
                </button>
              )
            })}
            <button type="button" className="spl-row spl-total" onClick={() => go('collect')} disabled={!onGo}>
              <span className="spl-what"><b>Collect now</b><small>finished or nearly finished work, not paid in full</small></span>
              <span className="spl-amt">{fmtUSD(live.collect)}</span>
            </button>
          </div>
          <div className="spl-note">Same queues as Payments › Collect balances; click a row to open it. Each order is counted once, under the queue closest to the door.</div>
        </div>
      </div>

      <div className="spl-panel">
        <h2>New stone orders · where they stand <span className="spl-h2r">{pipeTotal} open</span></h2>
        {pipeTotal === 0 ? <div className="spl-note">No open new-stone jobs.</div> : (
          <>
            <div className="spl-bar">
              {pipeSegs.filter(s => s.n > 0).map(s => (
                <div key={s.code} className="spl-seg" style={{ width: `${(s.n / pipeTotal) * 100}%`, background: s.color }} title={`${s.n} ${s.label}`}>{s.n} {s.short}</div>
              ))}
            </div>
            <div className="spl-pipe-legend">
              {pipeSegs.map(s => <span key={s.code}><i style={{ background: s.color }} />{s.label} <b>{s.n}</b></span>)}
            </div>
            <div className="spl-note">{pipeDonePct}% of open new-stone orders are carved or set. Read off each job's stone status and install step.</div>
          </>
        )}
      </div>

      <div className="spl-charts">
        <div className="spl-panel">
          <h2>Money in and sales signed · by week</h2>
          <PulseLines keys={weekly.keys} fmt={money0} label="Money in and sales signed, last 12 weeks"
            lines={[{ label: 'Money in', color: '#1f7a3d', values: weekly.s.money }, { label: 'Sales signed', color: '#9A7209', values: weekly.s.sales }]} />
        </div>
        <div className="spl-panel">
          <h2>Work done · by week</h2>
          <PulseLines keys={weekly.keys} fmt={count0} label="Stones blasted, installs, inscriptions and bronzes set, last 12 weeks"
            lines={[
              { label: 'Blasted', color: '#4a6fa5', values: weekly.s.blasted }, { label: 'Installed', color: '#1f7a3d', values: weekly.s.installed },
              { label: 'Inscriptions', color: '#c9962a', values: weekly.s.inscription }, { label: 'Bronzes set', color: '#b54040', values: weekly.s.bronze },
            ]} />
        </div>
      </div>

      <div className="spl-panel">
        <h2>What happened · {range.title}</h2>
        <div className="spl-lists">
          {lists.map(l => {
            const all = openList === l.code
            const rows = all ? l.rows : l.rows.slice(0, 6)
            return (
              <div key={l.code} className="spl-list">
                <div className="spl-list-h">{l.title} <b>{l.rows.length}</b></div>
                {l.rows.length === 0 && <div className="spl-note">None in this period.</div>}
                {rows.map((r, i) => (
                  <button type="button" key={i} className="spl-li" disabled={!onOpenOrder || !r.orderId} onClick={() => onOpenOrder?.(r.orderId)}>
                    <span className="spl-li-d">{shortDay(r.day)}</span>
                    <span className="spl-li-n">{r.name}<small>{[r.orderNo, l.mid(r)].filter(Boolean).join(' · ')}</small></span>
                    <span className="spl-li-a">{l.right(r)}</span>
                  </button>
                ))}
                {l.rows.length > 6 && <button type="button" className="spl-more" onClick={() => setOpenList(all ? null : l.code)}>{all ? 'Show fewer' : `Show all ${l.rows.length}`}</button>}
              </div>
            )
          })}
        </div>
        <div className="spl-note">Money in = payments recorded on family orders, by the day received. Cemetery order payments are kept in a separate ledger and are not in this number yet. Sales = contracts by signing day. Work = the day each step was marked done.</div>
      </div>
    </div>
  )
}

const SPL_CSS = `
  .spl { --bg: #f6f4ef; --fg: #1d1b17; --muted: #6f685c; --line: #e2ddd2; --surface: #fff; --gold: #9A7209; --green: #1f7a3d; --red: #b54040;
    display: flex; flex-direction: column; gap: 14px; color: var(--fg); min-width: 0; }
  .spl * { box-sizing: border-box; }
  .spl-load { padding: 60px; text-align: center; color: var(--muted); }
  .spl-err { background: #fbeaea; color: var(--red); border-radius: 8px; padding: 8px 12px; font-size: 13px; overflow-wrap: anywhere; }
  .spl-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .spl-head-l { min-width: 0; }
  .spl-head-r { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; min-width: 0; }
  .spl-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .spl-h1 { font-size: 24px; margin: 2px 0 0; font-weight: 600; }
  .spl-lede { color: var(--muted); font-size: 13.5px; margin: 4px 0 0; line-height: 1.5; overflow-wrap: anywhere; }
  .spl-chips, .spl-acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .spl-chip { font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; white-space: nowrap; }
  .spl-chip.on { background: var(--fg); color: #fff; border-color: transparent; font-weight: 600; }
  .spl-btn { font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: #6b5d3a; cursor: pointer; white-space: nowrap; }
  .spl-btn:hover { border-color: var(--gold); color: var(--gold); }

  .spl-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .spl-tile, .spl-panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
  .spl-lab { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .spl-big { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 4px; font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; overflow-wrap: anywhere; }
  .spl-sub { font-size: 12.5px; color: var(--muted); margin-top: 4px; line-height: 1.45; overflow-wrap: anywhere; }
  .spl-trend { font-size: 12px; margin-top: 6px; color: var(--muted); overflow-wrap: anywhere; }
  .spl-trend.up { color: var(--green); } .spl-trend.down { color: var(--red); }

  .spl-cols { display: grid; grid-template-columns: 1.1fr .9fr; gap: 12px; }
  .spl-panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
  .spl-n { background: var(--red); color: #fff; border-radius: 999px; font-size: 11px; padding: 1px 8px; letter-spacing: 0; }
  .spl-h2r { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .spl-rows { display: flex; flex-direction: column; }
  .spl-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 9px 0; border: none; border-bottom: 1px solid var(--line); background: none; font: inherit; font-size: 13.5px; color: inherit; text-align: left; cursor: pointer; min-width: 0; width: 100%; }
  .spl-row:disabled { cursor: default; }
  .spl-row:last-child { border-bottom: none; }
  .spl-row:hover:not(:disabled) .spl-what { color: var(--gold); }
  .spl-what { min-width: 0; overflow-wrap: anywhere; }
  .spl-what small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
  .spl-cnt { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .spl-row.hot .spl-cnt { color: var(--red); }
  .spl-go { font-size: 12px; color: var(--gold); white-space: nowrap; }
  .spl-money .spl-row { grid-template-columns: minmax(0, 1fr) auto; }
  .spl-amt { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-size: 18px; font-weight: 700; color: var(--red); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .spl-total { border-top: 1.5px solid var(--fg) !important; margin-top: 4px; padding-top: 10px; }
  .spl-total .spl-amt { font-size: 22px; }
  .spl-note { font-size: 12.5px; color: var(--muted); margin-top: 10px; line-height: 1.5; overflow-wrap: anywhere; }

  .spl-bar { display: flex; height: 26px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); }
  .spl-seg { display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 600; color: #fff; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 4px; }
  .spl-pipe-legend, .spl-legend { display: flex; gap: 6px 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); margin-top: 10px; }
  .spl-pipe-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  .spl-pipe-legend b, .spl-legend b { color: var(--fg); }

  .spl-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .spl-chart svg { width: 100%; height: auto; display: block; }
  .spl-grid { stroke: var(--line); stroke-width: 1; }
  .spl-cross { stroke: #b8b2a4; stroke-width: 1; stroke-dasharray: 3 3; }
  .spl-tick { fill: var(--muted); font-size: 10px; }
  .spl-tick.on { fill: var(--fg); font-weight: 700; }
  .spl-legend { margin-top: 6px; font-size: 12px; }
  .spl-legend i { display: inline-block; width: 18px; height: 2px; vertical-align: middle; margin-right: 6px; }
  .spl-legend-wk { margin-left: auto; }

  .spl-lists { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
  .spl-list { min-width: 0; }
  .spl-list-h { font-size: 12.5px; font-weight: 700; padding-bottom: 6px; border-bottom: 1.5px solid var(--fg); }
  .spl-list-h b { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; margin-left: 4px; color: var(--gold); }
  .spl-li { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%; padding: 6px 0; border: none; border-bottom: 1px solid var(--line); background: none; font: inherit; font-size: 13px; color: inherit; text-align: left; cursor: pointer; min-width: 0; }
  .spl-li:disabled { cursor: default; }
  .spl-li:hover:not(:disabled) .spl-li-n { color: var(--gold); }
  .spl-li-d { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .spl-li-n { min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
  .spl-li-n small { display: block; font-weight: 400; font-size: 11.5px; color: var(--muted); }
  .spl-li-a { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
  .spl-more { margin-top: 6px; background: none; border: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: #6b5d3a; cursor: pointer; text-decoration: underline; }

  @media (max-width: 900px) { .spl-tiles, .spl-cols, .spl-charts, .spl-lists { grid-template-columns: 1fr; } .spl-head-r { align-items: flex-start; } .spl-chips, .spl-acts { justify-content: flex-start; } }
`
