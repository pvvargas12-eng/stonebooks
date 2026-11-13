// =============================================================================
// SalesPerformanceView — Reports › Sales performance (SALES-PERF-1, 2026-11-13)
// =============================================================================
// Paul: "next to library I want a sales performance page — in depth analysis
// on sales made, leads we are tracking and then sales by employees. I want to
// see how much work each person is doing and their total sales, chasing leads,
// pipeline visible with all customers each employee is in contact with, last
// contact date and what the status of that lead is."
//
// One page, top to bottom: the period's sales and leads → every employee side
// by side (sales, leads, contacts logged, tasks finished) → pick a person →
// their pipeline (every open lead: status, last contact, next follow-up),
// their sales, and what they did lately. READ-ONLY; the truths and the rules
// (who owns a sale, what counts as a contact) live in lib/salesPerformance.js.
// An order with no name on it is credited to the first person who worked it
// and tagged ASSUMED; the page says how many of those there are.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { rowGrandTotal, rowTotalPaid, fmtUSD as fmtUSDc, fmtPhone, properName, customerName } from '../lib/stonebooksData'
import { isOrderRow, leadLeftOff, lostReasonLabel } from '../lib/leads'
import { loadSalesActivity, staffName } from '../lib/salesPerformance'
import { downloadReportCSV } from '../lib/reportsData'

const DAY = 86400000
// Whole dollars on this page: the tables are wide and cents add nothing here.
const fmtUSD = (n) => fmtUSDc(Math.round(Number(n) || 0)).replace(/[.]00$/, '')
const NOBODY = 'No name on the order'
const STALE_DAYS = 14
const PERIODS = [
  { code: 'week', label: 'This week' }, { code: 'month', label: 'This month' }, { code: 'quarter', label: 'Quarter' },
  { code: 'year', label: 'Year' }, { code: 'rolling', label: 'Last 12 months' },
]
const KINDS = ['New stone', 'Bronze', 'Inscription', 'Other']

// A bare YYYY-MM-DD is a LOCAL day (read at noon), same rule as the daily report.
const asDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? new Date(`${v}T12:00:00`) : new Date(v)
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayShort = (v) => { const d = asDate(v); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`

function periodOf(code, now) {
  const end = new Date(sod(now).getTime() + DAY)
  let start
  if (code === 'week') { start = sod(now); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) }
  else if (code === 'quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  else if (code === 'year') start = new Date(now.getFullYear(), 0, 1)
  else if (code === 'rolling') start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  else start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { start, end, title: `${dayShort(start)} to ${dayShort(now)}` }
}
const within = (v, r) => { if (!v) return false; const t = asDate(v).getTime(); return t >= r.start.getTime() && t < r.end.getTime() }

const kindOf = (o) => {
  const st = Array.isArray(o?.service_types) ? o.service_types : []
  if (st.some(s => ['NEW_STONE', 'CIVIC_MEMORIAL', 'MAUSOLEUM'].includes(s))) return 'New stone'
  if (st.includes('BRONZE')) return 'Bronze'
  if (st.includes('INSCRIPTION')) return 'Inscription'
  return 'Other'
}
const custOf = (o) => { const c = customerName(o?.customer); return c && c !== '—' ? properName(c) : '' }
const famOf = (o) => (String(o?.primary_lastname || '').trim() ? properName(String(o.primary_lastname).trim()) : '')
const nameOf = (o) => custOf(o) || famOf(o) || o?.order_number || 'Lead'
const daysAgoText = (n) => (n == null ? '' : n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)

// ── The whole model, built once per load / period ───────────────────────────
function buildModel(orders, act, now, range) {
  const today = sod(now)
  const byId = new Map()
  const rows = []
  for (const o of orders) {
    if (o.archived) continue
    const ex = act.extras.get(o.id) || {}
    const row = { ...o, sales_rep: ex.sales_rep ?? null, waiting_on: ex.waiting_on ?? null, next_follow_up: ex.next_follow_up ?? null,
      lost_at: ex.lost_at ?? null, lost_reason: ex.lost_reason ?? null, phone: ex.customer?.phone_primary || '' }
    rows.push(row); byId.set(o.id, row)
  }
  const ownerOf = (o) => {
    const named = staffName(o.sales_rep)
    if (named) return { name: named, assumed: false }
    const fw = act.firstWorker.get(o.id)
    if (fw) return { name: fw, assumed: true }
    return { name: NOBODY, assumed: false }
  }
  // Latest contact per order (touches arrive oldest first).
  const lastTouch = new Map(), touchN = new Map()
  for (const t of act.touches) { lastTouch.set(t.orderId, t); touchN.set(t.orderId, (touchN.get(t.orderId) || 0) + 1) }

  const people = new Map()
  const P = (name) => {
    if (!people.has(name)) people.set(name, { name, salesN: 0, salesUsd: 0, assumedN: 0, opened: 0, openedSigned: 0, openN: 0, pipeUsd: 0, staleN: 0, contacts: 0, tasks: 0, lastActive: null })
    return people.get(name)
  }

  const sales = [], leads = [], lost = []
  const totals = { salesN: 0, salesUsd: 0, opened: 0, openedSigned: 0, openN: 0, pipeUsd: 0, staleN: 0, lostN: 0, assumedN: 0, unnamedN: 0, dueN: 0 }
  const byKind = Object.fromEntries(KINDS.map(k => [k, { n: 0, usd: 0 }]))
  for (const o of rows) {
    const owner = ownerOf(o)
    const cancelled = o.status === 'cancelled'
    if (o.signed_at && !cancelled && within(o.signed_at, range)) {
      const total = rowGrandTotal(o) || 0
      sales.push({ o, owner, total, paid: rowTotalPaid(o) || 0, kind: kindOf(o) })
      const p = P(owner.name); p.salesN++; p.salesUsd += total; if (owner.assumed) { p.assumedN++; totals.assumedN++ }
      if (owner.name === NOBODY) totals.unnamedN++
      totals.salesN++; totals.salesUsd += total
      byKind[kindOf(o)].n++; byKind[kindOf(o)].usd += total
    }
    if (within(o.created_at, range) && !cancelled) {
      const p = P(owner.name); p.opened++; totals.opened++
      if (o.signed_at) { p.openedSigned++; totals.openedSigned++ }
    }
    if (o.lost_at && within(o.lost_at, range)) { lost.push({ o, owner }); totals.lostN++ }
    const open = !isOrderRow(o, rowTotalPaid(o)) && !['closed', 'cancelled'].includes(o.status) && !o.lost_at
    if (open) {
      const last = lastTouch.get(o.id) || null
      const since = last ? Math.max(0, Math.floor((today.getTime() - sod(asDate(last.at)).getTime()) / DAY)) : null
      const value = rowGrandTotal(o) || 0
      const stale = since == null || since >= STALE_DAYS
      const due = !!o.next_follow_up && String(o.next_follow_up).slice(0, 10) <= ymd(today)
      leads.push({ o, owner, value, left: leadLeftOff(o), last, since, stale, due, touches: touchN.get(o.id) || 0 })
      const p = P(owner.name); p.openN++; p.pipeUsd += value; if (stale) p.staleN++
      totals.openN++; totals.pipeUsd += value; if (stale) totals.staleN++; if (due) totals.dueN++
    }
  }
  const feed = []
  for (const t of act.touches) {
    if (!t.who) continue
    const p = P(t.who)
    if (!p.lastActive || t.at > p.lastActive) p.lastActive = t.at
    if (t.kind !== 'Task done' && within(t.at, range)) p.contacts++
    if (within(t.at, range)) feed.push(t)
  }
  for (const t of act.tasksDone) {
    if (!t.who) continue
    const p = P(t.who)
    if (!p.lastActive || t.at > p.lastActive) p.lastActive = t.at
    if (within(t.at, range)) { p.tasks++; if (!t.orderId) feed.push({ orderId: null, who: t.who, at: t.at, kind: 'Task done', text: t.title }) }
  }
  feed.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const list = [...people.values()].sort((a, b) =>
    (a.name === NOBODY) - (b.name === NOBODY) || b.salesUsd - a.salesUsd || b.contacts - a.contacts || b.openN - a.openN || a.name.localeCompare(b.name))

  // Sales by month, last 12, for the trend bars (all signed, whoever owns them).
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-US', { month: 'short' }), by: new Map(), n: 0, usd: 0 } })
  const mIdx = new Map(months.map((m, i) => [m.key, i]))
  for (const o of rows) {
    if (!o.signed_at || o.status === 'cancelled') continue
    const d = asDate(o.signed_at); if (isNaN(d)) continue
    const i = mIdx.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    if (i == null) continue
    const total = rowGrandTotal(o) || 0, who = ownerOf(o).name
    months[i].n++; months[i].usd += total
    const b = months[i].by.get(who) || { n: 0, usd: 0 }; b.n++; b.usd += total; months[i].by.set(who, b)
  }
  return { people: list, sales, leads, lost, totals, byKind, feed, months, byId }
}

const LEAD_SORTS = [
  { code: 'contact', label: 'Longest since contact' }, { code: 'value', label: 'Highest value' },
  { code: 'new', label: 'Newest lead' }, { code: 'follow', label: 'Follow-up day' },
]
const LEAD_FILTERS = [
  { code: 'all', label: 'All' }, { code: 'stale', label: 'Needs a touch' }, { code: 'due', label: 'Follow-up due' },
  { code: 'us', label: 'Waiting on us' }, { code: 'quoted', label: 'Quoted / contract sent' },
]

export default function SalesPerformanceView({ bundle, now, onOpenOrder = null, preload = null }) {
  const [act, setAct] = useState(preload)
  const [err, setErr] = useState(null)
  const [period, setPeriod] = useState('month')
  const [who, setWho] = useState(null)             // null = everyone
  const [sort, setSort] = useState('contact')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [more, setMore] = useState({ leads: false, sales: false, feed: false })

  useEffect(() => {
    if (preload) return
    let alive = true
    loadSalesActivity().then(a => { if (alive) setAct(a) }).catch(e => { if (alive) setErr(String(e?.message || e)) })
    return () => { alive = false }
  }, [preload])

  const range = useMemo(() => periodOf(period, now), [period, now])
  const orders = useMemo(() => bundle?.orders || [], [bundle])
  const m = useMemo(() => (act ? buildModel(orders, act, now, range) : null), [orders, act, now, range])

  const leadsShown = useMemo(() => {
    if (!m) return []
    const t = q.trim().toLowerCase()
    const list = m.leads.filter(l => {
      if (who && l.owner.name !== who) return false
      if (filter === 'stale' && !l.stale) return false
      if (filter === 'due' && !l.due) return false
      if (filter === 'us' && l.left.tone !== 'us') return false
      if (filter === 'quoted' && !['quoted', 'contract_sent'].includes(l.left.code)) return false
      if (t && ![custOf(l.o), famOf(l.o), l.o.order_number, l.o.phone, l.left.label, l.owner.name, l.o.cemetery?.name].filter(Boolean).join(' ').toLowerCase().includes(t)) return false
      return true
    })
    const cmp = {
      contact: (a, b) => (b.since ?? 99999) - (a.since ?? 99999) || b.value - a.value,
      value: (a, b) => b.value - a.value,
      new: (a, b) => String(b.o.created_at || '').localeCompare(String(a.o.created_at || '')),
      follow: (a, b) => String(a.o.next_follow_up || '9999').localeCompare(String(b.o.next_follow_up || '9999')),
    }[sort]
    return [...list].sort(cmp)
  }, [m, who, filter, q, sort])

  if (err) return <div className="spf"><style>{CSS}</style><div className="spf-err">Could not load the sales activity: {err}</div></div>
  if (!m) return <div className="spf"><style>{CSS}</style><div className="spf-load">Loading sales performance…</div></div>

  const T = m.totals
  const sel = who ? m.people.find(p => p.name === who) : null
  const salesShown = m.sales.filter(s => !who || s.owner.name === who).sort((a, b) => String(b.o.signed_at).localeCompare(String(a.o.signed_at)))
  const feedShown = m.feed.filter(t => !who || t.who === who)
  const maxUsd = Math.max(1, ...m.people.map(p => p.salesUsd))
  const closeRate = T.opened ? Math.round((T.openedSigned / T.opened) * 100) : null
  const monthVal = (mo) => (who ? (mo.by.get(who) || { n: 0, usd: 0 }) : mo)
  const maxMonth = Math.max(1, ...m.months.map(mo => monthVal(mo).usd))
  const pipeUsd = leadsShown.reduce((s, l) => s + l.value, 0)
  const todayYmd = ymd(sod(now))
  const lostBy = m.lost.filter(l => !who || l.owner.name === who).reduce((acc, l) => { const k = lostReasonLabel(l.o.lost_reason || 'other'); acc[k] = (acc[k] || 0) + 1; return acc }, {})

  const csv = () => downloadReportCSV(`pipeline-${who || 'everyone'}-${todayYmd}.csv`,
    ['Customer', 'Family', 'Order', 'Phone', 'Looking for', 'Value', 'Lead status', 'Last contact', 'Days since', 'Last contact by', 'How', 'Next follow-up', 'Started', 'Employee', 'Assumed'],
    leadsShown.map(l => [custOf(l.o), famOf(l.o), l.o.order_number || '', l.o.phone, kindOf(l.o), Math.round(l.value), l.left.label,
      l.last ? ymd(asDate(l.last.at)) : '', l.since ?? '', l.last?.who || '', l.last?.kind || '', String(l.o.next_follow_up || '').slice(0, 10), String(l.o.created_at || '').slice(0, 10), l.owner.name, l.owner.assumed ? 'yes' : '']))

  const leadRows = more.leads ? leadsShown : leadsShown.slice(0, 40)
  const saleRows = more.sales ? salesShown : salesShown.slice(0, 15)
  const feedRows = more.feed ? feedShown.slice(0, 200) : feedShown.slice(0, 15)

  return (
    <div className="spf">
      <style>{CSS}</style>
      <div className="spf-head">
        <div className="spf-head-l">
          <h2 className="spf-h1">Sales performance</h2>
          <p className="spf-lede">Sales made, leads being chased and the work behind them, by employee. {range.title}.</p>
        </div>
        <div className="spf-chips">
          {PERIODS.map(p => <button key={p.code} type="button" className={`spf-chip${period === p.code ? ' on' : ''}`} onClick={() => setPeriod(p.code)}>{p.label}</button>)}
        </div>
      </div>

      <div className="spf-tiles">
        <div className="spf-tile"><div className="spf-lab">Sales signed</div><div className="spf-big">{T.salesN}</div><div className="spf-sub">{fmtUSD(T.salesUsd)} in contracts</div></div>
        <div className="spf-tile"><div className="spf-lab">Average sale</div><div className="spf-big">{T.salesN ? fmtUSD(Math.round(T.salesUsd / T.salesN)) : '—'}</div><div className="spf-sub">{KINDS.filter(k => m.byKind[k].n).map(k => `${m.byKind[k].n} ${k.toLowerCase()}`).join(' · ') || 'no sales in this period'}</div></div>
        <div className="spf-tile"><div className="spf-lab">Leads opened</div><div className="spf-big">{T.opened}</div><div className="spf-sub">{closeRate == null ? 'none opened in this period' : `${T.openedSigned} of them signed so far (${closeRate}%)`}</div></div>
        <div className="spf-tile"><div className="spf-lab">Open leads now</div><div className="spf-big">{T.openN}</div><div className="spf-sub">{fmtUSD(T.pipeUsd)} quoted in the pipeline</div></div>
        <div className={`spf-tile${T.staleN ? ' warn' : ''}`}><div className="spf-lab">Need a touch</div><div className="spf-big">{T.staleN}</div><div className="spf-sub">open leads with no contact in {STALE_DAYS}+ days{T.dueN ? ` · ${T.dueN} follow-ups due` : ''}</div></div>
        <div className="spf-tile"><div className="spf-lab">Leads lost</div><div className="spf-big">{T.lostN}</div><div className="spf-sub">{Object.entries(lostBy).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ') || 'none marked lost'}</div></div>
      </div>

      {/* ── Every employee, side by side ─────────────────────────────────── */}
      <div className="spf-panel">
        <h3>By employee <span className="spf-h3r">click a person to see their pipeline, sales and activity</span></h3>
        <div className="spf-scroll">
          <table className="spf-table spf-emp">
            <thead><tr>
              <th>Employee</th><th className="r">Sales</th><th className="r">Contract value</th><th className="r">Avg sale</th>
              <th className="r">Leads opened</th><th className="r">Open leads</th><th className="r">Pipeline</th>
              <th className="r">Need a touch</th><th className="r">Contacts logged</th><th className="r">Tasks done</th><th>Last active</th>
            </tr></thead>
            <tbody>
              <tr className={`click${!who ? ' on' : ''}`} onClick={() => setWho(null)}>
                <td className="b">Everyone</td><td className="r mono">{T.salesN}</td><td className="r mono">{fmtUSD(T.salesUsd)}</td>
                <td className="r mono">{T.salesN ? fmtUSD(Math.round(T.salesUsd / T.salesN)) : '—'}</td><td className="r mono">{T.opened}</td>
                <td className="r mono">{T.openN}</td><td className="r mono">{fmtUSD(T.pipeUsd)}</td><td className="r mono">{T.staleN}</td>
                <td className="r mono">{m.people.reduce((s, p) => s + p.contacts, 0)}</td><td className="r mono">{m.people.reduce((s, p) => s + p.tasks, 0)}</td><td />
              </tr>
              {m.people.map(p => (
                <tr key={p.name} className={`click${who === p.name ? ' on' : ''}${p.name === NOBODY ? ' dim' : ''}`} onClick={() => setWho(who === p.name ? null : p.name)}>
                  <td className="b">{p.name}{p.assumedN > 0 && <small>{p.assumedN} of {p.salesN} assumed</small>}</td>
                  <td className="r mono">{p.salesN}</td>
                  <td className="r mono"><span className="spf-barcell"><i style={{ width: `${(p.salesUsd / maxUsd) * 100}%` }} /><b>{fmtUSD(p.salesUsd)}</b></span></td>
                  <td className="r mono">{p.salesN ? fmtUSD(Math.round(p.salesUsd / p.salesN)) : '—'}</td>
                  <td className="r mono">{p.opened}{p.opened > 0 && <small>{p.openedSigned} signed</small>}</td>
                  <td className="r mono">{p.openN}</td>
                  <td className="r mono">{fmtUSD(p.pipeUsd)}</td>
                  <td className={`r mono${p.staleN ? ' red' : ''}`}>{p.staleN}</td>
                  <td className="r mono">{p.contacts}</td>
                  <td className="r mono">{p.tasks}</td>
                  <td>{p.lastActive ? dayShort(p.lastActive) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="spf-note">
          A sale or lead belongs to the name picked on the order. {T.assumedN + T.unnamedN > 0 ? `${T.assumedN + T.unnamedN} of the ${T.salesN} sales in this period carry no name: ${T.assumedN} are credited to the first person who worked the order (shown as assumed), ${T.unnamedN} to nobody. ` : ''}
          Contacts = notes, calls, texts and status changes a person typed on an order. Emails sent count toward a lead&apos;s last contact but not toward a person. Leads opened counts everything started in the period, website inquiries included.
        </div>
      </div>

      <div className="spf-cols">
        <div className="spf-panel">
          <h3>Sales by month · {who || 'everyone'} <span className="spf-h3r">last 12 months</span></h3>
          <div className="spf-months">
            {m.months.map(mo => {
              const v = monthVal(mo)
              return (
                <div key={mo.key} className="spf-month" title={`${mo.label}: ${plural(v.n, 'sale')}, ${fmtUSD(v.usd)}`}>
                  <span className="spf-month-v">{v.n || ''}</span>
                  <span className="spf-month-bar"><i style={{ height: `${Math.max(v.usd ? 4 : 0, (v.usd / maxMonth) * 100)}%` }} /></span>
                  <span className="spf-month-l">{mo.label}</span>
                </div>
              )
            })}
          </div>
          <div className="spf-note">Bar = contract value signed that month, the number on top = how many sales.</div>
        </div>
        <div className="spf-panel">
          <h3>What sold · {range.title}</h3>
          <table className="spf-table">
            <thead><tr><th>Type</th><th className="r">Sales</th><th className="r">Contract value</th><th className="r">Share</th></tr></thead>
            <tbody>
              {KINDS.map(k => {
                const rowsK = salesShown.filter(s => s.kind === k)
                const usd = rowsK.reduce((s, x) => s + x.total, 0)
                const all = salesShown.reduce((s, x) => s + x.total, 0)
                return <tr key={k}><td>{k}</td><td className="r mono">{rowsK.length}</td><td className="r mono">{fmtUSD(usd)}</td><td className="r mono">{all ? `${Math.round((usd / all) * 100)}%` : '—'}</td></tr>
              })}
            </tbody>
          </table>
          {sel && <div className="spf-note">{sel.name}: {plural(sel.salesN, 'sale')} worth {fmtUSD(sel.salesUsd)}, {plural(sel.openN, 'open lead')} worth {fmtUSD(sel.pipeUsd)}, {plural(sel.contacts, 'contact')} logged and {plural(sel.tasks, 'task')} finished in this period.</div>}
        </div>
      </div>

      {/* ── The pipeline ──────────────────────────────────────────────────── */}
      <div className="spf-panel">
        <h3>Pipeline · {who || 'everyone'} <span className="spf-count">{leadsShown.length}</span> <span className="spf-h3r">{fmtUSD(pipeUsd)} quoted</span></h3>
        <div className="spf-bar">
          <div className="spf-chips left">
            <button type="button" className={`spf-chip sm${!who ? ' on' : ''}`} onClick={() => setWho(null)}>Everyone</button>
            {m.people.filter(p => p.openN > 0).map(p => <button key={p.name} type="button" className={`spf-chip sm${who === p.name ? ' on' : ''}`} onClick={() => setWho(p.name)}>{p.name} <b>{p.openN}</b></button>)}
          </div>
          <div className="spf-chips left">
            {LEAD_FILTERS.map(f => <button key={f.code} type="button" className={`spf-chip sm${filter === f.code ? ' on' : ''}`} onClick={() => setFilter(f.code)}>{f.label}</button>)}
            <select className="spf-in" value={sort} onChange={e => setSort(e.target.value)}>{LEAD_SORTS.map(s => <option key={s.code} value={s.code}>Sort: {s.label}</option>)}</select>
            <input className="spf-in" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, status" />
            <button type="button" className="spf-btn" onClick={csv}>CSV</button>
          </div>
        </div>
        {leadsShown.length === 0 ? <div className="spf-note">No open leads match.</div> : (
          <div className="spf-scroll">
            <table className="spf-table spf-leads">
              <thead><tr><th>Customer</th><th>Phone</th><th>Looking for</th><th className="r">Value</th><th>Lead status</th><th>Last contact</th><th>Next follow-up</th><th>Started</th><th>Employee</th></tr></thead>
              <tbody>
                {leadRows.map(l => (
                  <tr key={l.o.id} className={onOpenOrder ? 'click' : ''} onClick={() => onOpenOrder?.(l.o.id)}>
                    <td className="b">{nameOf(l.o)}<small>{[famOf(l.o) && famOf(l.o) !== custOf(l.o) ? `${famOf(l.o)} family` : '', l.o.order_number, l.o.cemetery?.name].filter(Boolean).join(' · ')}</small></td>
                    <td className="mono nowrap">{l.o.phone ? fmtPhone(l.o.phone) : '—'}</td>
                    <td>{kindOf(l.o)}</td>
                    <td className="r mono">{l.value ? fmtUSD(l.value) : '—'}</td>
                    <td><span className={`spf-st tone-${l.left.tone}`}>{l.left.label}</span></td>
                    <td className={l.stale ? 'red' : ''}>
                      {l.last ? <>{dayShort(l.last.at)} · {daysAgoText(l.since)}<small>{[l.last.kind, l.last.who].filter(Boolean).join(' · ')}{l.last.text ? `: ${String(l.last.text).slice(0, 90)}` : ''}</small></> : <>No contact logged<small>nothing in the last year</small></>}
                    </td>
                    <td className={l.due ? 'red nowrap' : 'nowrap'}>{l.o.next_follow_up ? dayShort(String(l.o.next_follow_up).slice(0, 10)) : '—'}{l.due && <small>due</small>}</td>
                    <td className="nowrap">{dayShort(l.o.created_at)}</td>
                    <td>{l.owner.name === NOBODY ? '—' : l.owner.name}{l.owner.assumed && <small>assumed</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {leadsShown.length > 40 && <button type="button" className="spf-more" onClick={() => setMore(s => ({ ...s, leads: !s.leads }))}>{more.leads ? 'Show fewer' : `Show all ${leadsShown.length}`}</button>}
        <div className="spf-note">Open leads = not signed with money down, not closed, not marked lost. Click a row to open the lead; its status and follow-up day are set at the top of that page. Red = no contact in {STALE_DAYS}+ days or a follow-up that is due.</div>
      </div>

      <div className="spf-cols">
        <div className="spf-panel">
          <h3>Sales made · {who || 'everyone'} <span className="spf-count">{salesShown.length}</span> <span className="spf-h3r">{fmtUSD(salesShown.reduce((s, x) => s + x.total, 0))}</span></h3>
          {salesShown.length === 0 ? <div className="spf-note">No contracts signed in this period.</div> : (
            <div className="spf-scroll">
              <table className="spf-table">
                <thead><tr><th>Signed</th><th>Family</th><th>Type</th><th className="r">Contract</th><th className="r">Paid</th><th>Employee</th></tr></thead>
                <tbody>
                  {saleRows.map(s => (
                    <tr key={s.o.id} className={onOpenOrder ? 'click' : ''} onClick={() => onOpenOrder?.(s.o.id)}>
                      <td className="nowrap">{dayShort(s.o.signed_at)}</td>
                      <td className="b">{famOf(s.o) || custOf(s.o) || s.o.order_number}<small>{s.o.order_number}</small></td>
                      <td>{s.kind}</td><td className="r mono">{fmtUSD(s.total)}</td><td className="r mono">{fmtUSD(s.paid)}</td>
                      <td>{s.owner.name === NOBODY ? '—' : s.owner.name}{s.owner.assumed && <small>assumed</small>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {salesShown.length > 15 && <button type="button" className="spf-more" onClick={() => setMore(s => ({ ...s, sales: !s.sales }))}>{more.sales ? 'Show fewer' : `Show all ${salesShown.length}`}</button>}
        </div>
        <div className="spf-panel">
          <h3>Work logged · {who || 'everyone'} <span className="spf-count">{feedShown.length}</span></h3>
          {feedShown.length === 0 ? <div className="spf-note">Nothing logged in this period.</div> : (
            <div className="spf-feed">
              {feedRows.map((t, i) => {
                const o = t.orderId ? m.byId.get(t.orderId) : null
                return (
                  <button type="button" key={i} className="spf-feed-row" disabled={!o || !onOpenOrder} onClick={() => o && onOpenOrder?.(o.id)}>
                    <span className="spf-feed-d">{dayShort(t.at)}</span>
                    <span className="spf-feed-n">{o ? (famOf(o) || custOf(o) || o.order_number) : 'Shop task'}<small>{t.who} · {t.kind}: {String(t.text || '').slice(0, 120)}</small></span>
                  </button>
                )
              })}
            </div>
          )}
          {feedShown.length > 15 && <button type="button" className="spf-more" onClick={() => setMore(s => ({ ...s, feed: !s.feed }))}>{more.feed ? 'Show fewer' : `Show more (${Math.min(200, feedShown.length)})`}</button>}
          <div className="spf-note">Typed notes, calls, texts, status changes and finished tasks. Payments taken and files added are not counted here.</div>
        </div>
      </div>
    </div>
  )
}

const CSS = `
  .spf { --fg: #1d1b17; --muted: #6f685c; --line: #e2ddd2; --surface: #fff; --gold: #9A7209; --green: #1f7a3d; --red: #b54040;
    display: flex; flex-direction: column; gap: 14px; color: var(--fg); min-width: 0; }
  .spf * { box-sizing: border-box; }
  .spf-load, .spf-err { padding: 50px; text-align: center; color: var(--muted); }
  .spf-err { color: var(--red); overflow-wrap: anywhere; }
  .spf-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
  .spf-head-l { min-width: 0; }
  .spf-h1 { font-size: 22px; font-weight: 600; margin: 0; }
  .spf-lede { font-size: 13.5px; color: var(--muted); margin: 4px 0 0; overflow-wrap: anywhere; }
  .spf-chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center; min-width: 0; }
  .spf-chips.left { justify-content: flex-start; }
  .spf-chip { font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; white-space: nowrap; }
  .spf-chip.sm { font-size: 12px; padding: 5px 11px; }
  .spf-chip b { font-weight: 700; margin-left: 3px; }
  .spf-chip.on { background: var(--fg); color: #fff; border-color: transparent; font-weight: 600; }
  .spf-btn, .spf-in { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); min-width: 0; }
  .spf-btn { font-weight: 600; color: #6b5d3a; cursor: pointer; }
  .spf-btn:hover { border-color: var(--gold); color: var(--gold); }
  .spf-in[type=search] { width: 210px; max-width: 100%; }

  .spf-tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
  .spf-tile, .spf-panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 13px 15px; min-width: 0; }
  .spf-tile.warn { border-color: var(--red); }
  .spf-tile.warn .spf-big { color: var(--red); }
  .spf-lab { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .spf-big { font-size: 24px; font-weight: 600; margin-top: 4px; font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .spf-sub { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.45; overflow-wrap: anywhere; }

  .spf-panel h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 10px; font-weight: 700; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; overflow-wrap: anywhere; }
  .spf-h3r { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .spf-count { background: var(--fg); color: #fff; border-radius: 999px; font-size: 11px; padding: 1px 8px; letter-spacing: 0; }
  .spf-note { font-size: 12.5px; color: var(--muted); margin-top: 10px; line-height: 1.5; overflow-wrap: anywhere; }
  .spf-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .spf-bar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }

  .spf-scroll { overflow-x: auto; }
  .spf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .spf-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 6px 8px; border-bottom: 1.5px solid var(--fg); white-space: nowrap; }
  .spf-table td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
  .spf-table tr:last-child td { border-bottom: none; }
  .spf-table .r { text-align: right; }
  .spf-table .mono { font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .spf-table .nowrap { white-space: nowrap; }
  .spf-table .b { font-weight: 600; }
  .spf-table small { display: block; font-weight: 400; font-size: 11.5px; color: var(--muted); font-family: inherit; white-space: normal; }
  .spf-table .red, .spf-table .red small { color: var(--red); }
  .spf-table tr.click { cursor: pointer; }
  .spf-table tr.click:hover td { background: #faf7ef; }
  .spf-table tr.on td { background: #f3ecd9; }
  .spf-table tr.dim td { color: var(--muted); }
  .spf-emp { min-width: 980px; }
  .spf-leads { min-width: 1040px; }
  .spf-leads td:nth-child(6) { min-width: 200px; max-width: 320px; }
  .spf-barcell { position: relative; display: inline-block; min-width: 120px; text-align: right; padding: 1px 4px; }
  .spf-barcell i { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(154,114,9,.18); border-radius: 3px; }
  .spf-barcell b { position: relative; font-weight: 600; }
  .spf-st { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
  .spf-st.tone-us { color: var(--red); border-color: var(--red); }
  .spf-st.tone-sent { color: var(--green); border-color: var(--green); }
  .spf-st.tone-new { color: #185FA5; border-color: #378ADD; }

  .spf-months { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; align-items: end; }
  .spf-month { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
  .spf-month-v { font-size: 11px; font-weight: 700; min-height: 14px; font-family: var(--font-m, 'JetBrains Mono'), Consolas, monospace; }
  .spf-month-bar { height: 110px; width: 100%; display: flex; align-items: flex-end; background: #f6f4ef; border-radius: 4px; overflow: hidden; }
  .spf-month-bar i { display: block; width: 100%; background: var(--gold); border-radius: 4px 4px 0 0; }
  .spf-month-l { font-size: 10.5px; color: var(--muted); white-space: nowrap; }

  .spf-feed { display: flex; flex-direction: column; }
  .spf-feed-row { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 7px 0; border: none; border-bottom: 1px solid var(--line); background: none; font: inherit; font-size: 13px; color: inherit; text-align: left; cursor: pointer; min-width: 0; width: 100%; }
  .spf-feed-row:disabled { cursor: default; }
  .spf-feed-row:hover:not(:disabled) .spf-feed-n { color: var(--gold); }
  .spf-feed-d { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .spf-feed-n { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .spf-feed-n small { display: block; font-weight: 400; font-size: 11.5px; color: var(--muted); }
  .spf-more { margin-top: 8px; background: none; border: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: #6b5d3a; cursor: pointer; text-decoration: underline; }

  @media (max-width: 1100px) { .spf-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 800px) { .spf-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .spf-cols { grid-template-columns: 1fr; } .spf-chips { justify-content: flex-start; } }
`
