// =============================================================================
// OwnerStatsView — Reports › Owner stats (STATS-1, 2026-09-17; STATS-2, 2026-10-30)
// =============================================================================
// Paul: "this reports is trash, I want stats on jobs Sales by month week year,
// by type. How many orders complete by month week year... how many active
// orders do we have by type stuff like that true data that i can use as an
// owner."
// STATS-2 (2026-10-30): "I did 192 in sales but then I want to see how much
// came in with payments and deposits because it's not real money until it's
// paid in full. Interactive — click Oct 2026 and see all 55 sales, then by
// all / new stone / bronze. For production: installs and inscriptions by
// week, a bar graph of deliveries by week, same with stones, so I can see
// if my volume is the same, up or down."
//
// One surface, four truths, zero derived cleverness:
//   • ACTIVE NOW — signed + money down, nothing terminal; counted per service
//     type with MULTI-membership (a New stone + Acid wash order counts under
//     both — the standing Dziamba rule).
//   • SALES — orders by the date the CONTRACT WAS SIGNED (count + contract $
//     from the line-item engine), bucketed by week / month / year.
//   • CASH IN — every locked, non-voided payment by the day it was RECEIVED
//     (receivedAt — the field every write path stamps), whatever period the
//     order was signed in. Deposits and balances alike: money that landed.
//   • COMPLETED — orders whose install/completion milestone went DONE, dated
//     by that milestone's own status_date, same buckets.
//   • PRODUCTION — per JOB: deliveries (install milestone done on stone /
//     bronze / door jobs), stones blasted (production_completed done on new
//     stone jobs), inscriptions completed — each by the milestone's own date.
// Any period row opens: the sales / payments / completions behind it, with
// type chips. The type chips at the top re-slice everything on the page.
// =============================================================================
import { useState, useMemo, useEffect } from 'react'
import { rowGrandTotal, rowMoneyDown, rowBalanceDue, rowTotalPaid, rowNonVoidedPayments, fmtUSD, fmtDate, properName, customerName } from '../lib/stonebooksData'
import { downloadReportCSV } from '../lib/reportsData'
import { schedcLabel } from '../lib/acctData'
import { getLineStats } from '../lib/floorLines'

const INSTALL_KEYS = ['installed', 'door_installed', 'work_completed']
const LEAD_STATUSES = new Set(['draft', 'scoping', 'quoted'])
const TERMINAL_STATUSES = new Set(['closed', 'cancelled'])

const SERVICE_LABELS = {
  NEW_STONE: 'New stone', BRONZE: 'Bronze', INSCRIPTION: 'Inscription',
  ACID_WASH: 'Acid wash', REPAIR: 'Repair', MAUSOLEUM: 'Mausoleum',
  MAUSOLEUM_DOOR: 'Doors', CIVIC_MEMORIAL: 'Civic', ADD_PHOTO: 'Photo', OTHER: 'Other',
}
const servicesOf = (o) => {
  const st = o?.service_types
  return Array.isArray(st) && st.length ? st.filter(s => SERVICE_LABELS[s]) : ['OTHER']
}
const familyOf = (o) => {
  const last = (o?.primary_lastname || '').trim()
  if (last) return properName(last)
  const cn = customerName(o?.customer)
  return cn && cn !== '—' ? properName(cn) : (o?.order_number || 'Unknown')
}
const METHOD_LABEL = { cash: 'Cash', check: 'Check', card: 'Card', credit_card: 'Card', zelle: 'Zelle', ach: 'ACH', bank_transfer: 'ACH', other: 'Other' }

// ── Period bucketing (local time, Monday weeks) ─────────────────────────────
const MON = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// A bare YYYY-MM-DD is a LOCAL day (new Date('2026-10-03') would be UTC
// midnight = the evening before in New Jersey).
const asDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? new Date(`${iso}T12:00:00`) : new Date(iso)
function periodKey(iso, gran) {
  const d = asDate(iso)
  if (isNaN(d.getTime())) return null
  if (gran === 'year') return String(d.getFullYear())
  if (gran === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const m = MON(d)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`
}
function periodLabel(key, gran) {
  if (gran === 'year') return key
  if (gran === 'month') { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
  const [y, m, d] = key.split('-')
  return `wk of ${Number(m)}/${Number(d)}/${String(y).slice(2)}`
}
// Short axis label for the bar charts.
function tickLabel(key, gran) {
  if (gran === 'year') return key
  if (gran === 'month') { const [, m] = key.split('-'); return MONTHS[Number(m) - 1] }
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}
// The last N period keys ending at `now`, newest first.
function lastPeriods(now, gran, n) {
  const out = []
  if (gran === 'year') {
    for (let i = 0; i < n; i++) out.push(String(now.getFullYear() - i))
  } else if (gran === 'month') {
    let y = now.getFullYear(), m = now.getMonth()
    for (let i = 0; i < n; i++) { out.push(`${y}-${String(m + 1).padStart(2, '0')}`); m--; if (m < 0) { m = 11; y-- } }
  } else {
    const cur = MON(now)
    for (let i = 0; i < n; i++) {
      const d = new Date(cur.getTime() - i * 7 * 86400000)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
  }
  return out
}
const periodCount = (gran) => gran === 'year' ? 6 : gran === 'month' ? 12 : 12
const prodPeriodCount = (gran) => gran === 'year' ? 6 : gran === 'month' ? 12 : 26
const spanLabel = (gran, n) => gran === 'year' ? `last ${n} years` : gran === 'month' ? `last ${n} months` : `last ${n} weeks`

// The day a payment landed. Every write path stamps receivedAt (YYYY-MM-DD);
// createdAt is the last resort for anything older.
const paymentDay = (p) => (p?.receivedAt && String(p.receivedAt).slice(0, 10)) || (p?.createdAt && String(p.createdAt).slice(0, 10)) || null

// ── Bar chart (one series, one hue, the app's gold) ─────────────────────────
// Oldest on the left, newest on the right. Value labels ride every non-empty
// bar (small integer counts read fine); a hover tooltip names the period.
function BarChart({ series, gran, label, tone = 'gold' }) {
  const [hover, setHover] = useState(null)
  const W = 900, H = 200, padL = 28, padR = 10, padT = 22, padB = 30
  const n = series.length
  const max = Math.max(1, ...series.map(s => s.value))
  const innerW = W - padL - padR, innerH = H - padT - padB
  const slot = innerW / Math.max(1, n)
  const barW = Math.max(4, Math.min(34, slot * 0.68))
  const y = (v) => padT + innerH - (v / max) * innerH
  // Gridlines at 0 / half / max (whole numbers).
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)
  const showEvery = n > 14 ? 2 : 1
  const fill = tone === 'green' ? '#2E7D4F' : tone === 'blue' ? '#2F5D9E' : '#C9A468'
  return (
    <div className="ost-chart">
      <div className="ost-chart-title">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ost-chart-svg" role="img" aria-label={`${label} by period`}
        onMouseLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="ost-grid" />
            <text x={padL - 5} y={y(t) + 3.5} className="ost-tick" textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="ost-axis" />
        {series.map((s, i) => {
          const cx = padL + slot * i + slot / 2
          const x0 = cx - barW / 2
          const top = y(s.value)
          const h = Math.max(0, y(0) - top)
          const on = hover === i
          return (
            <g key={s.key}
              onMouseEnter={() => setHover(i)}
              onMouseMove={() => setHover(i)}>
              {/* The hit target spans the whole slot, so thin bars are easy to hover. */}
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              {s.value > 0 && (
                <rect x={x0} y={top} width={barW} height={h} rx={3} ry={3} fill={fill} opacity={hover == null || on ? 1 : 0.55} />
              )}
              {s.value > 0 && (
                <text x={cx} y={top - 5} className="ost-val" textAnchor="middle">{s.value}</text>
              )}
              {(i % showEvery === 0 || i === n - 1) && (
                <text x={cx} y={H - padB + 15} className={`ost-tick${on ? ' on' : ''}`} textAnchor="middle">{tickLabel(s.key, gran)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="ost-chart-foot">
        {hover != null && series[hover]
          ? <span className="ost-chart-tip"><b>{series[hover].value}</b> · {periodLabel(series[hover].key, gran)}</span>
          : <span className="ost-chart-tip muted">hover a bar for the period</span>}
      </div>
    </div>
  )
}

// "Last 4 vs the 4 before" — the plain-words trend line under each chart.
function trendWords(series, gran) {
  const n = gran === 'year' ? 1 : gran === 'month' ? 3 : 4
  if (series.length < n * 2) return null
  const recent = series.slice(-n), prior = series.slice(-n * 2, -n)
  const avg = (xs) => xs.reduce((s, x) => s + x.value, 0) / xs.length
    , a = avg(recent), b = avg(prior)
  const unit = gran === 'year' ? 'yr' : gran === 'month' ? 'mo' : 'wk'
  const r1 = Math.round(a * 10) / 10, r0 = Math.round(b * 10) / 10
  const span = gran === 'year' ? 'this year vs last' : gran === 'month' ? 'last 3 months vs the 3 before' : 'last 4 weeks vs the 4 before'
  const word = a > b * 1.1 ? 'up' : a < b * 0.9 ? 'down' : 'holding'
  return { text: `${r1} per ${unit} vs ${r0} per ${unit} — ${span}`, word }
}

export default function OwnerStatsView({ bundle, now, onOpenOrder }) {
  const [gran, setGran] = useState('month')       // 'week' | 'month' | 'year'
  const [typeFilter, setTypeFilter] = useState('') // '' = all
  const [drillKey, setDrillKey] = useState(null)   // the open period row
  const [drillTab, setDrillTab] = useState('sales')// 'sales' | 'cash' | 'completed'
  const [drillType, setDrillType] = useState('')   // type chip inside the drill
  const [prodGran, setProdGran] = useState('week')
  const [prodTable, setProdTable] = useState(false)

  const orders = bundle?.orders || []
  const jobs = bundle?.jobs || []
  // CASH OUT (Paul 2026-10-30: "not only cash in but also cash out") = the
  // Accounting book — confirmed rows AND inbox lines (a bank line is money
  // gone whether or not it has been filed yet). Type chips cannot slice it.
  const expenses = bundle?.expenses || []
  const orderById = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders])

  // Completion date per ORDER — the earliest done install-key milestone's own
  // status_date across the order's jobs (the honest "we finished it" date).
  const completionByOrder = useMemo(() => {
    const m = new Map()
    for (const j of jobs) {
      const oid = j.order_id || j.order?.id
      if (!oid) continue
      for (const ms of (j.milestones || [])) {
        if (!INSTALL_KEYS.includes(ms.milestone_key) || ms.status !== 'done' || !ms.status_date) continue
        const prev = m.get(oid)
        if (!prev || ms.status_date < prev) m.set(oid, ms.status_date)
      }
    }
    return m
  }, [jobs])

  const matchesType = (o) => !typeFilter || servicesOf(o).includes(typeFilter)

  // ── ACTIVE NOW — signed + money down, nothing terminal ────────────────────
  const active = useMemo(() => orders.filter(o =>
    !o.archived && !LEAD_STATUSES.has(o.status) && !TERMINAL_STATUSES.has(o.status)
    && o.signed_at && rowMoneyDown(o)), [orders])
  const activeByType = useMemo(() => {
    const m = new Map()
    for (const o of active) for (const s of servicesOf(o)) {
      const e = m.get(s) || { count: 0, owed: 0 }
      e.count++; e.owed += Math.max(0, rowBalanceDue(o))
      m.set(s, e)
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [active])
  const activeFiltered = useMemo(() => active.filter(matchesType), [active, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps
  const activeOwed = useMemo(() => activeFiltered.reduce((s, o) => s + Math.max(0, rowBalanceDue(o)), 0), [activeFiltered])

  // ── SALES + CASH IN + COMPLETED per period (each row keeps its lists) ─────
  const table = useMemo(() => {
    const keys = lastPeriods(now, gran, periodCount(gran))
    const rows = new Map(keys.map(k => [k, { key: k, sales: 0, salesUsd: 0, cashIn: 0, cashN: 0, cashOut: 0, outN: 0, completed: 0, salesOrders: [], payments: [], outRows: [], completedOrders: [] }]))
    for (const e of expenses) {
      if (!e.expense_date || !(Number(e.amount) > 0)) continue
      const k = periodKey(e.expense_date, gran)
      const r = k && rows.get(k)
      if (r) { r.cashOut += Number(e.amount); r.outN++; r.outRows.push(e) }
    }
    for (const o of orders) {
      if (!matchesType(o)) continue
      if (o.signed_at) {
        const k = periodKey(o.signed_at, gran)
        const r = k && rows.get(k)
        if (r) { r.sales++; r.salesUsd += rowGrandTotal(o) || 0; r.salesOrders.push(o) }
      }
      for (const p of rowNonVoidedPayments(o)) {
        const day = paymentDay(p)
        const amt = Number(p.amount) || 0
        if (!day || amt <= 0) continue
        const k = periodKey(day, gran)
        const r = k && rows.get(k)
        if (r) { r.cashIn += amt; r.cashN++; r.payments.push({ order: o, payment: p, day, amount: amt }) }
      }
      const doneAt = completionByOrder.get(o.id)
      if (doneAt) {
        const k = periodKey(doneAt, gran)
        const r = k && rows.get(k)
        if (r) { r.completed++; r.completedOrders.push(o) }
      }
    }
    for (const r of rows.values()) {
      r.salesOrders.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))
      r.payments.sort((a, b) => b.day.localeCompare(a.day))
      r.outRows.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)) || (Number(b.amount) - Number(a.amount)))
      r.completedOrders.sort((a, b) => String(completionByOrder.get(b.id)).localeCompare(String(completionByOrder.get(a.id))))
    }
    return keys.map(k => rows.get(k))
  }, [orders, expenses, completionByOrder, gran, now, typeFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => table.reduce((a, r) => ({
    sales: a.sales + r.sales, salesUsd: a.salesUsd + r.salesUsd, cashIn: a.cashIn + r.cashIn, cashN: a.cashN + r.cashN, cashOut: a.cashOut + r.cashOut, outN: a.outN + r.outN, completed: a.completed + r.completed,
  }), { sales: 0, salesUsd: 0, cashIn: 0, cashN: 0, cashOut: 0, outN: 0, completed: 0 }), [table])

  const exportCsv = () => {
    downloadReportCSV(
      `owner-stats-${gran}${typeFilter ? `-${typeFilter.toLowerCase()}` : ''}.csv`,
      ['Period', 'New sales', 'Sales $', 'Avg sale $', 'Cash in $', 'Payments', 'Cash out $', 'Expense lines', 'Net cash $', 'Completed'],
      table.map(r => [periodLabel(r.key, gran), r.sales, r.salesUsd.toFixed(2), r.sales ? (r.salesUsd / r.sales).toFixed(2) : '', r.cashIn.toFixed(2), r.cashN, r.cashOut.toFixed(2), r.outN, (r.cashIn - r.cashOut).toFixed(2), r.completed]),
    )
  }

  const maxUsd = Math.max(1, ...table.map(r => Math.max(r.salesUsd, r.cashIn, r.cashOut)))

  // ── The drill: the rows behind a period ───────────────────────────────────
  const drillRow = useMemo(() => table.find(r => r.key === drillKey) || null, [table, drillKey])
  const openDrill = (key, tab) => {
    if (drillKey === key && (!tab || tab === drillTab)) { setDrillKey(null); return }
    setDrillKey(key); if (tab) setDrillTab(tab); setDrillType('')
  }
  const drillList = useMemo(() => {
    if (!drillRow) return []
    const inType = (o) => !drillType || servicesOf(o).includes(drillType)
    if (drillTab === 'cash') return drillRow.payments.filter(x => inType(x.order))
    if (drillTab === 'out') return drillRow.outRows
    if (drillTab === 'completed') return drillRow.completedOrders.filter(inType)
    return drillRow.salesOrders.filter(inType)
  }, [drillRow, drillTab, drillType])
  const drillTypes = useMemo(() => {
    if (!drillRow || drillTab === 'out') return []
    const src = drillTab === 'cash' ? drillRow.payments.map(x => x.order) : drillTab === 'completed' ? drillRow.completedOrders : drillRow.salesOrders
    const m = new Map()
    for (const o of src) for (const s of servicesOf(o)) m.set(s, (m.get(s) || 0) + 1)
    return Object.keys(SERVICE_LABELS).filter(s => m.has(s)).map(s => [s, m.get(s)])
  }, [drillRow, drillTab])
  const drillSum = useMemo(() => {
    if (drillTab === 'cash') return drillList.reduce((s, x) => s + x.amount, 0)
    if (drillTab === 'out') return drillList.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    return drillList.reduce((s, o) => s + (rowGrandTotal(o) || 0), 0)
  }, [drillList, drillTab])
  // Cash out, grouped by category for the drill's summary line.
  const outByCat = useMemo(() => {
    if (drillTab !== 'out') return []
    const m = new Map()
    for (const e of drillList) { const k = e.category || 'uncategorized'; m.set(k, (m.get(k) || 0) + (Number(e.amount) || 0)) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [drillList, drillTab])

  // ── PRODUCTION per period — per JOB, by the milestone's own date ──────────
  const production = useMemo(() => {
    const keys = lastPeriods(now, prodGran, prodPeriodCount(prodGran)).reverse()   // oldest first for the charts
    const mk = () => new Map(keys.map(k => [k, 0]))
    const deliveries = mk(), blasted = mk(), inscriptions = mk()
    const bump = (m, iso) => { const k = periodKey(iso, prodGran); if (k && m.has(k)) m.set(k, m.get(k) + 1) }
    for (const j of jobs) {
      const o = orderById.get(j.order_id || j.order?.id)
      if (typeFilter && o && !servicesOf(o).includes(typeFilter)) continue
      const ms = j.milestones || []
      const done = (key) => { const m = ms.find(x => x.milestone_key === key && x.status === 'done' && x.status_date); return m ? m.status_date : null }
      if (j.job_type === 'inscription') {
        const d = done('inscription_completed') || done('work_completed')
        if (d) bump(inscriptions, d)
        continue
      }
      const inst = INSTALL_KEYS.map(done).find(Boolean)
      if (inst) bump(deliveries, inst)
      if (j.job_type === 'new_stone') { const b = done('production_completed'); if (b) bump(blasted, b) }
    }
    const toSeries = (m) => keys.map(k => ({ key: k, value: m.get(k) }))
    return { keys, deliveries: toSeries(deliveries), blasted: toSeries(blasted), inscriptions: toSeries(inscriptions) }
  }, [jobs, orderById, prodGran, now, typeFilter])
  const prodTotals = useMemo(() => ({
    deliveries: production.deliveries.reduce((s, x) => s + x.value, 0),
    blasted: production.blasted.reduce((s, x) => s + x.value, 0),
    inscriptions: production.inscriptions.reduce((s, x) => s + x.value, 0),
  }), [production])
  const exportProdCsv = () => {
    downloadReportCSV(
      `production-${prodGran}.csv`,
      ['Period', 'Deliveries', 'Stones blasted', 'Inscriptions'],
      production.keys.map((k, i) => [periodLabel(k, prodGran), production.deliveries[i].value, production.blasted[i].value, production.inscriptions[i].value]).reverse(),
    )
  }

  // ── PRODUCTION LINES (LINES-1, Paul 2026-10-08: "how many lines a week we
  // are doing, time to complete lines, how many a year") ──────────────────────
  const [lineStats, setLineStats] = useState(null)
  useEffect(() => {
    let alive = true
    getLineStats().then(s => { if (alive) setLineStats(s) }).catch(() => { if (alive) setLineStats({ completed: [], running: [], planned: 0, avgDays: null, avgStones: null }) })
    return () => { alive = false }
  }, [])
  const lineTable = useMemo(() => {
    if (!lineStats) return []
    const keys = lastPeriods(now, gran, periodCount(gran))
    const rows = new Map(keys.map(k => [k, { key: k, lines: 0, stones: 0, days: [] }]))
    for (const l of lineStats.completed) {
      const k = periodKey(l.completed_at, gran)
      const r = k && rows.get(k)
      if (r) { r.lines++; r.stones += l.stones; r.days.push(l.days) }
    }
    return keys.map(k => rows.get(k))
  }, [lineStats, gran, now])
  const lineTotals = useMemo(() => lineTable.reduce((a, r) => ({ lines: a.lines + r.lines, stones: a.stones + r.stones }), { lines: 0, stones: 0 }), [lineTable])

  const open = (id) => { if (id && onOpenOrder) onOpenOrder(id) }
  const typeTags = (o) => servicesOf(o).map(s => SERVICE_LABELS[s]).join(' · ')

  return (
    <div className="ost">
      <style>{CSS}</style>

      {/* Type chips re-slice EVERYTHING on the page (multi-membership). */}
      <div className="ost-chips">
        <button type="button" className={`ost-chip${typeFilter === '' ? ' on' : ''}`} onClick={() => setTypeFilter('')}>All types</button>
        {Object.keys(SERVICE_LABELS).filter(s => activeByType.some(([t]) => t === s) || orders.some(o => servicesOf(o).includes(s))).map(s => (
          <button type="button" key={s} className={`ost-chip${typeFilter === s ? ' on' : ''}`}
            title="Combined orders count under every type they carry"
            onClick={() => setTypeFilter(f => (f === s ? '' : s))}>{SERVICE_LABELS[s]}</button>
        ))}
      </div>

      {/* ACTIVE NOW */}
      <div className="ost-cards">
        <div className="ost-card ost-card-big">
          <div className="ost-card-l">Active orders{typeFilter ? ` — ${SERVICE_LABELS[typeFilter]}` : ''}</div>
          <div className="ost-card-v">{activeFiltered.length}</div>
          <div className="ost-card-s">signed · money down · not closed</div>
        </div>
        <div className="ost-card ost-card-big">
          <div className="ost-card-l">Owed on them</div>
          <div className="ost-card-v">{fmtUSD(activeOwed)}</div>
          <div className="ost-card-s">open balances on that work</div>
        </div>
        {activeByType.map(([s, e]) => (
          <button type="button" key={s} className={`ost-card ost-card-type${typeFilter === s ? ' on' : ''}`}
            onClick={() => setTypeFilter(f => (f === s ? '' : s))}>
            <div className="ost-card-l">{SERVICE_LABELS[s]}</div>
            <div className="ost-card-v">{e.count}</div>
            <div className="ost-card-s">owed {fmtUSD(e.owed)}</div>
          </button>
        ))}
      </div>

      {/* SALES + CASH IN + COMPLETED trend */}
      <div className="ost-panel">
        <div className="ost-panel-head">
          <span className="ost-panel-title">Sales, cash in, cash out & completions{typeFilter ? ` — ${SERVICE_LABELS[typeFilter]}` : ''}</span>
          <div className="ost-grans">
            {[['week', 'By week'], ['month', 'By month'], ['year', 'By year']].map(([code, label]) => (
              <button type="button" key={code} className={`ost-chip${gran === code ? ' on' : ''}`} onClick={() => { setGran(code); setDrillKey(null) }}>{label}</button>
            ))}
          </div>
          <button type="button" className="ost-csv" onClick={exportCsv}>Export CSV</button>
        </div>
        <div className="ost-hint">
          Sales = contracts SIGNED in the period (count + contract total). Cash in = every payment RECEIVED in the
          period, deposits and balances, whenever the order was signed. Cash out = every expense in the Accounting
          book (confirmed or still in the inbox) by the day it was paid; the type chips do not slice it. Completed = the
          install/completion milestone went done in the period. Newest first. <b>Click a row</b> to see the orders,
          payments and expenses behind it.
        </div>
        <table className="ost-table ost-table-click">
          <thead>
            <tr>
              <th>Period</th><th className="n">New sales</th><th className="n">Sales $</th><th className="n">Cash in</th><th className="n">Cash out</th>
              <th className="bar"><span className="ost-key"><i className="k-gold" />sales $ <i className="k-green" />cash in <i className="k-red" />cash out</span></th>
              <th className="n">Avg sale</th><th className="n">Completed</th>
            </tr>
          </thead>
          <tbody>
            {table.map(r => {
              const on = drillKey === r.key
              return [
                <tr key={r.key} className={`ost-row${on ? ' on' : ''}`} onClick={() => openDrill(r.key)} title="Click to see the orders behind this period">
                  <td className="p">{periodLabel(r.key, gran)}</td>
                  <td className="n"><button type="button" className="ost-cell-btn" onClick={e => { e.stopPropagation(); openDrill(r.key, 'sales') }}>{r.sales || '—'}</button></td>
                  <td className="n money">{r.salesUsd ? fmtUSD(r.salesUsd) : '—'}</td>
                  <td className="n money cash"><button type="button" className="ost-cell-btn" onClick={e => { e.stopPropagation(); openDrill(r.key, 'cash') }}>{r.cashIn ? fmtUSD(r.cashIn) : '—'}</button></td>
                  <td className="n money out"><button type="button" className="ost-cell-btn" onClick={e => { e.stopPropagation(); openDrill(r.key, 'out') }}>{r.cashOut ? fmtUSD(r.cashOut) : '—'}</button></td>
                  <td className="bar">
                    <i className="b-gold" style={{ width: `${Math.round((r.salesUsd / maxUsd) * 100)}%` }} />
                    <i className="b-green" style={{ width: `${Math.round((r.cashIn / maxUsd) * 100)}%` }} />
                    <i className="b-red" style={{ width: `${Math.round((r.cashOut / maxUsd) * 100)}%` }} />
                  </td>
                  <td className="n">{r.sales ? fmtUSD(Math.round(r.salesUsd / r.sales)) : '—'}</td>
                  <td className="n"><button type="button" className="ost-cell-btn" onClick={e => { e.stopPropagation(); openDrill(r.key, 'completed') }}>{r.completed || '—'}</button></td>
                </tr>,
                on && drillRow && (
                  <tr key={`${r.key}-drill`} className="ost-drill-tr">
                    <td colSpan={8}>
                      <div className="ost-drill">
                        <div className="ost-drill-head">
                          <span className="ost-drill-title">{periodLabel(r.key, gran)}</span>
                          <div className="ost-drill-tabs">
                            <button type="button" className={`ost-chip${drillTab === 'sales' ? ' on' : ''}`} onClick={() => { setDrillTab('sales'); setDrillType('') }}>Sales {drillRow.sales} · {fmtUSD(drillRow.salesUsd)}</button>
                            <button type="button" className={`ost-chip${drillTab === 'cash' ? ' on' : ''}`} onClick={() => { setDrillTab('cash'); setDrillType('') }}>Cash in {fmtUSD(drillRow.cashIn)} · {drillRow.cashN} payment{drillRow.cashN === 1 ? '' : 's'}</button>
                            <button type="button" className={`ost-chip${drillTab === 'out' ? ' on' : ''}`} onClick={() => { setDrillTab('out'); setDrillType('') }}>Cash out {fmtUSD(drillRow.cashOut)} · {drillRow.outN} line{drillRow.outN === 1 ? '' : 's'}</button>
                            <button type="button" className={`ost-chip${drillTab === 'completed' ? ' on' : ''}`} onClick={() => { setDrillTab('completed'); setDrillType('') }}>Completed {drillRow.completed}</button>
                          </div>
                          <button type="button" className="ost-drill-close" onClick={() => setDrillKey(null)}>Close</button>
                        </div>
                        {drillTypes.length > 1 && (
                          <div className="ost-chips ost-chips-sm">
                            <button type="button" className={`ost-chip${drillType === '' ? ' on' : ''}`} onClick={() => setDrillType('')}>All</button>
                            {drillTypes.map(([s, n]) => (
                              <button type="button" key={s} className={`ost-chip${drillType === s ? ' on' : ''}`} onClick={() => setDrillType(t => (t === s ? '' : s))}>{SERVICE_LABELS[s]} <b>{n}</b></button>
                            ))}
                          </div>
                        )}
                        <div className="ost-drill-sum">
                          {drillList.length} {drillTab === 'cash' ? 'payment' : drillTab === 'out' ? 'expense line' : 'order'}{drillList.length === 1 ? '' : 's'}
                          {drillType ? ` · ${SERVICE_LABELS[drillType]}` : ''} · {fmtUSD(drillSum)}{drillTab === 'cash' ? ' received' : drillTab === 'out' ? ' paid out' : ' contract value'}
                        </div>
                        {drillTab === 'out' && outByCat.length > 0 && (
                          <div className="ost-chips ost-chips-sm">
                            {outByCat.map(([c, v]) => <span key={c} className="ost-chip ost-chip-static">{schedcLabel(c)} <b>{fmtUSD(v)}</b></span>)}
                          </div>
                        )}
                        {drillList.length === 0 ? <div className="ost-hint">Nothing in this period.</div> : (
                          <table className="ost-table ost-drill-table">
                            <thead>
                              {drillTab === 'out' ? (
                                <tr><th>Paid</th><th>Payee</th><th>What</th><th>Category</th><th>Status</th><th className="n">Amount</th></tr>
                              ) : drillTab === 'cash' ? (
                                <tr><th>Family</th><th>Order</th><th>Type</th><th>Cemetery</th><th className="n">Received</th><th>Method</th><th className="n">Amount</th><th className="n">Contract</th><th className="n">Still owed</th></tr>
                              ) : (
                                <tr><th>Family</th><th>Order</th><th>Type</th><th>Cemetery</th><th className="n">{drillTab === 'completed' ? 'Completed' : 'Signed'}</th><th className="n">Contract</th><th className="n">Paid</th><th className="n">Still owed</th></tr>
                              )}
                            </thead>
                            <tbody>
                              {drillTab === 'out' ? drillList.map(e => (
                                <tr key={e.id}>
                                  <td className="n">{e.expense_date ? fmtDate(e.expense_date) : '—'}</td>
                                  <td className="p">{e.vendor || '—'}</td>
                                  <td className="t" title={e.note || ''}>{e.note || '—'}</td>
                                  <td>{schedcLabel(e.category)}</td>
                                  <td>{e.status === 'confirmed' ? 'In the book' : 'Inbox — not filed yet'}</td>
                                  <td className="n money out">{fmtUSD(Number(e.amount) || 0)}</td>
                                </tr>
                              )) : drillTab === 'cash' ? drillList.map((x, i) => {
                                const o = x.order, owed = rowBalanceDue(o)
                                return (
                                  <tr key={`${o.id}-${x.payment?.id || i}`} className="ost-row" onClick={() => open(o.id)} title="Open the order">
                                    <td className="p">{familyOf(o)}</td>
                                    <td className="mono">{o.order_number || '—'}</td>
                                    <td className="t">{typeTags(o)}</td>
                                    <td className="t">{o.cemetery?.name ? properName(o.cemetery.name) : '—'}</td>
                                    <td className="n">{fmtDate(x.day)}</td>
                                    <td>{METHOD_LABEL[x.payment?.method] || x.payment?.method || '—'}{x.payment?.ref ? ` · ${x.payment.ref}` : ''}</td>
                                    <td className="n money cash">{fmtUSD(x.amount)}</td>
                                    <td className="n money">{fmtUSD(rowGrandTotal(o) || 0)}</td>
                                    <td className={`n money${owed > 0 ? ' owed' : ''}`}>{owed > 0 ? fmtUSD(owed) : 'paid'}</td>
                                  </tr>
                                )
                              }) : drillList.map(o => {
                                const owed = rowBalanceDue(o)
                                const when = drillTab === 'completed' ? completionByOrder.get(o.id) : o.signed_at
                                return (
                                  <tr key={o.id} className="ost-row" onClick={() => open(o.id)} title="Open the order">
                                    <td className="p">{familyOf(o)}</td>
                                    <td className="mono">{o.order_number || '—'}</td>
                                    <td className="t">{typeTags(o)}</td>
                                    <td className="t">{o.cemetery?.name ? properName(o.cemetery.name) : '—'}</td>
                                    <td className="n">{when ? fmtDate(when) : '—'}</td>
                                    <td className="n money">{fmtUSD(rowGrandTotal(o) || 0)}</td>
                                    <td className="n money">{fmtUSD(rowTotalPaid(o) || 0)}</td>
                                    <td className={`n money${owed > 0 ? ' owed' : ''}`}>{owed > 0 ? fmtUSD(owed) : 'paid'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="p">Total ({spanLabel(gran, periodCount(gran))})</td>
              <td className="n">{totals.sales}</td>
              <td className="n money">{fmtUSD(totals.salesUsd)}</td>
              <td className="n money cash">{fmtUSD(totals.cashIn)}</td>
              <td className="n money out">{fmtUSD(totals.cashOut)}</td>
              <td className="bar"></td>
              <td className="n">{totals.sales ? fmtUSD(Math.round(totals.salesUsd / totals.sales)) : '—'}</td>
              <td className="n">{totals.completed}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* PRODUCTION — volume over time */}
      <div className="ost-panel">
        <div className="ost-panel-head">
          <span className="ost-panel-title">Production{typeFilter ? ` — ${SERVICE_LABELS[typeFilter]}` : ''}</span>
          <div className="ost-grans">
            {[['week', 'By week'], ['month', 'By month'], ['year', 'By year']].map(([code, label]) => (
              <button type="button" key={code} className={`ost-chip${prodGran === code ? ' on' : ''}`} onClick={() => setProdGran(code)}>{label}</button>
            ))}
            <button type="button" className={`ost-chip${prodTable ? ' on' : ''}`} onClick={() => setProdTable(v => !v)}>{prodTable ? 'Charts' : 'Table'}</button>
          </div>
          <button type="button" className="ost-csv" onClick={exportProdCsv}>Export CSV</button>
        </div>
        <div className="ost-hint">
          Counted per job on the day the milestone was marked. Deliveries = installed / set (stones, bronze, doors).
          Stones blasted = the blasted milestone on new-stone jobs. Inscriptions = inscription completed. {spanLabel(prodGran, prodPeriodCount(prodGran))}, oldest on the left.
        </div>
        <div className="ost-cards ost-cards-3">
          {[['Deliveries', prodTotals.deliveries, production.deliveries], ['Stones blasted', prodTotals.blasted, production.blasted], ['Inscriptions', prodTotals.inscriptions, production.inscriptions]].map(([label, total, series]) => {
            const t = trendWords(series, prodGran)
            return (
              <div key={label} className="ost-card">
                <div className="ost-card-l">{label}</div>
                <div className="ost-card-v">{total}</div>
                <div className="ost-card-s">
                  {spanLabel(prodGran, prodPeriodCount(prodGran))}
                  {t && <> · <span className={`ost-trend ost-trend-${t.word}`}>{t.word}</span> — {t.text}</>}
                </div>
              </div>
            )
          })}
        </div>
        {prodTable ? (
          <table className="ost-table">
            <thead><tr><th>Period</th><th className="n">Deliveries</th><th className="n">Stones blasted</th><th className="n">Inscriptions</th></tr></thead>
            <tbody>
              {[...production.keys].map((k, i) => ({ k, i })).reverse().map(({ k, i }) => (
                <tr key={k}>
                  <td className="p">{periodLabel(k, prodGran)}</td>
                  <td className="n">{production.deliveries[i].value || '—'}</td>
                  <td className="n">{production.blasted[i].value || '—'}</td>
                  <td className="n">{production.inscriptions[i].value || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="p">Total</td><td className="n">{prodTotals.deliveries}</td><td className="n">{prodTotals.blasted}</td><td className="n">{prodTotals.inscriptions}</td></tr></tfoot>
          </table>
        ) : (
          <div className="ost-charts">
            <BarChart series={production.deliveries} gran={prodGran} label="Deliveries (installed / set)" tone="gold" />
            <BarChart series={production.blasted} gran={prodGran} label="Stones blasted" tone="blue" />
            <BarChart series={production.inscriptions} gran={prodGran} label="Inscriptions completed" tone="green" />
          </div>
        )}
      </div>

      {/* PRODUCTION LINES */}
      <div className="ost-panel">
        <div className="ost-panel-head">
          <span className="ost-panel-title">Production lines</span>
          <span className="ost-hint" style={{ margin: 0 }}>Assembly lines on the floor — a line completes when every stone on it is blasted.</span>
        </div>
        {!lineStats ? <div className="ost-hint">Loading…</div> : (
          <>
            <div className="ost-cards">
              <div className="ost-card">
                <div className="ost-card-l">Lines completed</div>
                <div className="ost-card-v">{lineStats.completed.length}</div>
                <div className="ost-card-s">all time</div>
              </div>
              <div className="ost-card">
                <div className="ost-card-l">Days per line</div>
                <div className="ost-card-v">{lineStats.avgDays == null ? '—' : Math.round(lineStats.avgDays * 10) / 10}</div>
                <div className="ost-card-s">started → blasted out, average</div>
              </div>
              <div className="ost-card">
                <div className="ost-card-l">Stones per line</div>
                <div className="ost-card-v">{lineStats.avgStones == null ? '—' : Math.round(lineStats.avgStones * 10) / 10}</div>
                <div className="ost-card-s">average on completed lines</div>
              </div>
              {lineStats.running.map(l => (
                <div key={l.id} className="ost-card">
                  <div className="ost-card-l">{l.label} · running</div>
                  <div className="ost-card-v">{l.counts.blasted} / {l.counts.total}</div>
                  <div className="ost-card-s">blasted · started {l.started_at ? new Date(l.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</div>
                </div>
              ))}
              <div className="ost-card">
                <div className="ost-card-l">Planned ahead</div>
                <div className="ost-card-v">{lineStats.planned}</div>
                <div className="ost-card-s">lines on deck or in planning</div>
              </div>
            </div>
            <table className="ost-table">
              <thead>
                <tr><th>Period</th><th className="n">Lines done</th><th className="n">Stones blasted</th><th className="n">Avg days / line</th></tr>
              </thead>
              <tbody>
                {lineTable.map(r => (
                  <tr key={r.key}>
                    <td className="p">{periodLabel(r.key, gran)}</td>
                    <td className="n">{r.lines || '—'}</td>
                    <td className="n">{r.stones || '—'}</td>
                    <td className="n">{r.days.length ? Math.round((r.days.reduce((s, x) => s + x, 0) / r.days.length) * 10) / 10 : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="p">Total</td>
                  <td className="n">{lineTotals.lines}</td>
                  <td className="n">{lineTotals.stones}</td>
                  <td className="n"></td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

const CSS = `
  .ost-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .ost-chips-sm { margin: 8px 0 6px; }
  .ost-chip { font: inherit; font-size: 12.5px; font-weight: 600; padding: 5px 14px; border-radius: 999px;
    border: 1px solid var(--sb-border, #E2D8C6); background: var(--sb-surface, #fff); color: #6a6a66; cursor: pointer; white-space: nowrap; }
  .ost-chip:hover { border-color: #C9A468; color: #16150F; }
  .ost-chip.on { background: #16150F; border-color: #16150F; color: #C9A468; font-weight: 700; }
  .ost-chip b { font-weight: 800; margin-left: 2px; }
  /* Overflow doctrine (Paul 2026-09-17: "i hate seeing words outside of the
     boxes"): cards clip, money never leaks — wide enough for $XXX,XXX.XX at
     the value size, and the value ellipsizes rather than escapes. */
  .ost-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .ost-cards-3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .ost-card { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 12px; padding: 12px 14px; text-align: left; font: inherit; min-width: 0; overflow: hidden; }
  .ost-card-big { border-left: 3px solid #9A7209; }
  .ost-card-type { cursor: pointer; }
  .ost-card-type:hover { border-color: #C9A468; }
  .ost-card-type.on { border-color: #9A7209; box-shadow: inset 0 0 0 1px #9A7209; }
  .ost-card-l { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a85; }
  .ost-card-v { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 21px; font-weight: 700; color: #16150F; margin: 3px 0 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .ost-card-s { font-size: 11.5px; color: #8a8a85; overflow-wrap: anywhere; }
  .ost-trend { font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .ost-trend-up { color: #2E7D4F; }
  .ost-trend-down { color: #B3261E; }
  .ost-trend-holding { color: #9A7209; }
  .ost-panel { background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 14px; padding: 16px 18px; overflow-x: auto; margin-bottom: 14px; }
  .ost-panel-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
  .ost-panel-title { font-size: 14px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
  .ost-grans { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
  .ost-csv { font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px;
    border: 1px solid #C9A468; background: none; color: #9A7209; cursor: pointer; }
  .ost-csv:hover { background: #9A7209; border-color: #9A7209; color: #fff; }
  .ost-hint { font-size: 12px; color: #8a8a85; margin-bottom: 10px; }
  .ost-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ost-table th { text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: #8a8a85; padding: 7px 10px; border-bottom: 1px solid var(--sb-border, #E2D8C6); }
  .ost-table td { padding: 7px 10px; border-bottom: 0.5px solid #f0ece2; }
  .ost-table .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ost-table .p { font-weight: 700; white-space: nowrap; }
  .ost-table .t { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ost-table .mono { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 12px; white-space: nowrap; }
  .ost-table .money { font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; font-size: 12.5px; }
  .ost-table .money.cash { color: #2E7D4F; font-weight: 700; }
  .ost-table .money.out { color: #B3261E; font-weight: 700; }
  .ost-table .bar i.b-red { background: #B3261E; margin-top: 2px; }
  .ost-key i.k-red { background: #B3261E; }
  .ost-chip-static { cursor: default; }
  .ost-chip-static:hover { border-color: var(--sb-border, #E2D8C6); color: #6a6a66; }
  .ost-table .money.owed { color: #B3261E; font-weight: 700; }
  .ost-table .bar { width: 20%; min-width: 110px; }
  .ost-table .bar i { display: block; height: 6px; border-radius: 4px; min-width: 2px; }
  .ost-table .bar i.b-gold { background: #C9A468; margin-bottom: 2px; }
  .ost-table .bar i.b-green { background: #2E7D4F; }
  .ost-key { display: inline-flex; align-items: center; gap: 4px; text-transform: none; letter-spacing: 0; font-weight: 600; }
  .ost-key i { display: inline-block; width: 10px; height: 6px; border-radius: 3px; margin-left: 6px; }
  .ost-key i.k-gold { background: #C9A468; margin-left: 0; }
  .ost-key i.k-green { background: #2E7D4F; }
  .ost-table tfoot td { border-top: 2px solid var(--sb-border, #E2D8C6); border-bottom: none; font-weight: 800; }
  .ost-table-click tbody tr.ost-row { cursor: pointer; }
  .ost-table-click tbody tr.ost-row:hover td { background: #faf6ee; }
  .ost-table-click tbody tr.ost-row.on td { background: #f6efdf; }
  .ost-cell-btn { font: inherit; background: none; border: none; padding: 0; color: inherit; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
  .ost-cell-btn:hover { color: #9A7209; }
  .ost-drill-tr td { background: #fcfaf5; padding: 0 0 12px; border-bottom: 2px solid var(--sb-border, #E2D8C6); }
  .ost-drill { padding: 10px 12px 2px; min-width: 0; }
  .ost-drill-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .ost-drill-title { font-size: 14px; font-weight: 800; }
  .ost-drill-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .ost-drill-close { margin-left: auto; font: inherit; font-size: 12px; font-weight: 700; background: none; border: 1px solid var(--sb-border, #E2D8C6); border-radius: 8px; padding: 4px 10px; color: #6a6a66; cursor: pointer; }
  .ost-drill-sum { font-size: 12.5px; font-weight: 700; color: #16150F; margin: 4px 0 6px; }
  .ost-drill-table { font-size: 13px; background: var(--sb-surface, #fff); border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 10px; overflow: hidden; }
  .ost-drill-table tbody tr.ost-row { cursor: pointer; }
  .ost-drill-table tbody tr.ost-row:hover td { background: #faf6ee; }
  /* One chart per row, full width — 26 weekly bars need the room; side by
     side the axis labels shrank to nothing. */
  .ost-charts { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .ost-chart-svg { max-height: 220px; }
  .ost-chart { min-width: 0; border: 0.5px solid var(--sb-border, #E2D8C6); border-radius: 12px; padding: 10px 12px 6px; background: var(--sb-surface, #fff); }
  .ost-chart-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #6a6a66; margin-bottom: 4px; }
  .ost-chart-svg { width: 100%; height: auto; display: block; }
  .ost-grid { stroke: #ebe6da; stroke-width: 1; }
  .ost-axis { stroke: #cfc7b6; stroke-width: 1; }
  .ost-tick { font-size: 10px; fill: #8a8a85; font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; }
  .ost-tick.on { fill: #16150F; font-weight: 700; }
  .ost-val { font-size: 10.5px; fill: #16150F; font-weight: 700; font-family: var(--sb-font-mono, 'JetBrains Mono'), monospace; }
  .ost-chart-foot { min-height: 18px; font-size: 12px; color: #16150F; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ost-chart-tip.muted { color: #a09c93; }
`
