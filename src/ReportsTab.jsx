// =============================================================================
// 📚 Stonebooks — Reports tab
// =============================================================================
// Sales analytics with Recharts:
//   - Headline KPIs (this month, this year, win rate, avg order value)
//   - Sales by month (line, year-to-date)
//   - Sales by rep (bar)
//   - Sales by service type (pie)
//   - Sales by referral source (bar)
//   - Order status pipeline (bar)
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  listAllOrders, statusInfo, ORDER_STATUSES, SOLD_STATUSES, ACTIVE_STATUSES,
  rowGrandTotal, fmtUSD, monthKey, monthLabel, monthsAgo,
} from './lib/stonebooksData'

const PIE_COLORS = ['#1d4ed8', '#0d9488', '#7c3aed', '#b8842a', '#b54040', '#5d5d5a', '#2d7a4f', '#0f1419']

export default function ReportsTab() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('12mo')   // '3mo' | '12mo' | 'ytd' | 'all'

  useEffect(() => {
    // Pull EVERYTHING once — we filter client-side for snappy report toggles.
    listAllOrders({ limit: 1000 }).then(rows => {
      setOrders(rows)
      setLoading(false)
    })
  }, [])

  // ── Date filter ──
  const cutoffDate = useMemo(() => {
    if (range === '3mo')  return monthsAgo(3)
    if (range === '12mo') return monthsAgo(12)
    if (range === 'ytd')  return new Date(new Date().getFullYear(), 0, 1)
    return new Date(0)
  }, [range])

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const d = new Date(o.created_at || o.updated_at)
      return d >= cutoffDate
    })
  }, [orders, cutoffDate])

  // ── KPIs ──
  const kpis = useMemo(() => {
    const sold = filteredOrders.filter(o => SOLD_STATUSES.includes(o.status))
    const cancelled = filteredOrders.filter(o => o.status === 'cancelled')
    const totalSold = sold.reduce((s, o) => s + rowGrandTotal(o), 0)
    const totalAttempted = sold.length + cancelled.length
    const winRate = totalAttempted > 0 ? Math.round((sold.length / totalAttempted) * 100) : null
    const avgOrder = sold.length > 0 ? totalSold / sold.length : 0

    // This month
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
    const thisMonthOrders = sold.filter(o => new Date(o.created_at) >= monthStart)
    const thisMonthSold = thisMonthOrders.reduce((s, o) => s + rowGrandTotal(o), 0)

    // This year
    const yearStart = new Date(new Date().getFullYear(), 0, 1)
    const thisYearOrders = sold.filter(o => new Date(o.created_at) >= yearStart)
    const thisYearSold = thisYearOrders.reduce((s, o) => s + rowGrandTotal(o), 0)

    return {
      thisMonth: thisMonthSold,
      thisMonthCount: thisMonthOrders.length,
      thisYear: thisYearSold,
      thisYearCount: thisYearOrders.length,
      winRate,
      winRateBase: totalAttempted,
      avgOrder,
      avgOrderCount: sold.length,
      totalSold,
      activeCount: filteredOrders.filter(o => ACTIVE_STATUSES.includes(o.status)).length,
    }
  }, [filteredOrders])

  // ── By month series ──
  const byMonth = useMemo(() => {
    const buckets = {}
    const sold = filteredOrders.filter(o => SOLD_STATUSES.includes(o.status))
    for (const o of sold) {
      const d = new Date(o.created_at)
      const key = monthKey(d)
      if (!buckets[key]) buckets[key] = { key, label: monthLabel(d), date: d, total: 0, count: 0 }
      buckets[key].total += rowGrandTotal(o)
      buckets[key].count++
    }
    return Object.values(buckets).sort((a, b) => a.date - b.date)
  }, [filteredOrders])

  // ── By rep ──
  const byRep = useMemo(() => {
    const buckets = {}
    const sold = filteredOrders.filter(o => SOLD_STATUSES.includes(o.status))
    for (const o of sold) {
      const rep = o.sales_rep || 'Unassigned'
      if (!buckets[rep]) buckets[rep] = { rep, total: 0, count: 0 }
      buckets[rep].total += rowGrandTotal(o)
      buckets[rep].count++
    }
    return Object.values(buckets).sort((a, b) => b.total - a.total)
  }, [filteredOrders])

  // ── By service type ──
  const byService = useMemo(() => {
    const buckets = {}
    for (const o of filteredOrders) {
      if (!SOLD_STATUSES.includes(o.status)) continue
      const services = o.service_types || []
      const total = rowGrandTotal(o)
      // Distribute order value across all selected services
      const each = services.length > 0 ? total / services.length : 0
      const labels = services.length > 0 ? services : ['Unknown']
      for (const s of labels) {
        const label = serviceLabel(s)
        if (!buckets[label]) buckets[label] = { name: label, total: 0, count: 0 }
        buckets[label].total += each
        buckets[label].count++
      }
    }
    return Object.values(buckets)
      .map(b => ({ ...b, total: Math.round(b.total) }))
      .sort((a, b) => b.total - a.total)
  }, [filteredOrders])

  // ── By referral source ──
  const byReferral = useMemo(() => {
    const buckets = {}
    const sold = filteredOrders.filter(o => SOLD_STATUSES.includes(o.status))
    for (const o of sold) {
      const src = o.referral_source || o.customer?.referral_source || 'Unknown'
      const label = referralLabel(src)
      if (!buckets[label]) buckets[label] = { name: label, total: 0, count: 0 }
      buckets[label].total += rowGrandTotal(o)
      buckets[label].count++
    }
    return Object.values(buckets).sort((a, b) => b.total - a.total)
  }, [filteredOrders])

  // ── Status pipeline ──
  const byStatus = useMemo(() => {
    const buckets = {}
    for (const o of filteredOrders) {
      const s = statusInfo(o.status)
      if (!buckets[s.code]) buckets[s.code] = { name: s.label, code: s.code, color: s.color, count: 0, total: 0 }
      buckets[s.code].count++
      buckets[s.code].total += rowGrandTotal(o)
    }
    // Stable order
    return ORDER_STATUSES
      .map(s => buckets[s.code])
      .filter(Boolean)
      .filter(b => b.count > 0)
  }, [filteredOrders])

  if (loading) return <div className="sb-page sb-page-wide"><div className="sb-empty">Loading reports…</div></div>

  const empty = orders.length === 0
  if (empty) {
    return (
      <div className="sb-page sb-page-wide">
        <div className="sb-page-head">
          <div className="sb-page-eyebrow">Workspace</div>
          <h1 className="sb-page-title">Reports</h1>
        </div>
        <div className="sb-empty">
          No orders yet. Reports populate as you write quotes and contracts.
          You can also seed test data to see how reports look — ask Claude to
          generate fake data when you're ready.
        </div>
      </div>
    )
  }

  return (
    <div className="sb-page sb-page-wide">
      <div className="sb-page-head sb-cal-head">
        <div>
          <div className="sb-page-eyebrow">Workspace</div>
          <h1 className="sb-page-title">Reports</h1>
        </div>
        <div className="sb-segmented">
          <button className={`sb-seg ${range === '3mo' ? 'on' : ''}`}  onClick={() => setRange('3mo')}>3 mo</button>
          <button className={`sb-seg ${range === '12mo' ? 'on' : ''}`} onClick={() => setRange('12mo')}>12 mo</button>
          <button className={`sb-seg ${range === 'ytd' ? 'on' : ''}`}  onClick={() => setRange('ytd')}>YTD</button>
          <button className={`sb-seg ${range === 'all' ? 'on' : ''}`}  onClick={() => setRange('all')}>All time</button>
        </div>
      </div>

      <div className="sb-metric-grid">
        <Metric label="This month" value={fmtUSD(kpis.thisMonth)} sub={`${kpis.thisMonthCount} sold`} />
        <Metric label="This year" value={fmtUSD(kpis.thisYear)} sub={`${kpis.thisYearCount} sold`} />
        <Metric label="In selected range" value={fmtUSD(kpis.totalSold)} sub={`${kpis.avgOrderCount} sold · ${kpis.activeCount} active`} />
        <Metric label="Average order" value={kpis.avgOrder > 0 ? fmtUSD(kpis.avgOrder) : '—'} sub={`across ${kpis.avgOrderCount} sales`} />
        <Metric label="Win rate" value={kpis.winRate != null ? `${kpis.winRate}%` : '—'} sub={`${kpis.winRateBase} attempts`} />
      </div>

      {/* Sales by month line chart */}
      <ChartCard title="Revenue by month" sub="Sum of contracted+ orders, grouped by month created">
        {byMonth.length > 1 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={byMonth} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" />
              <XAxis dataKey="label" stroke="var(--sb-text-muted)" fontSize={11} />
              <YAxis stroke="var(--sb-text-muted)" fontSize={11} tickFormatter={v => fmtUSD(v, { short: true })} />
              <Tooltip
                contentStyle={{ background: 'var(--sb-surface)', border: '0.5px solid var(--sb-border)', borderRadius: 6, fontSize: 12 }}
                formatter={(v) => fmtUSD(v)}
              />
              <Line type="monotone" dataKey="total" stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmpty>Not enough history yet.</ChartEmpty>}
      </ChartCard>

      <div className="sb-chart-row">
        {/* Sales by rep */}
        <ChartCard title="Revenue by rep" sub="Top performers in selected range">
          {byRep.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, byRep.length * 36)}>
              <BarChart data={byRep} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--sb-text-muted)" fontSize={11} tickFormatter={v => fmtUSD(v, { short: true })} />
                <YAxis dataKey="rep" type="category" stroke="var(--sb-text-muted)" fontSize={11} width={70} />
                <Tooltip
                  contentStyle={{ background: 'var(--sb-surface)', border: '0.5px solid var(--sb-border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v) => fmtUSD(v)}
                />
                <Bar dataKey="total" fill="#1d4ed8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>No sales by rep yet.</ChartEmpty>}
        </ChartCard>

        {/* Service type pie */}
        <ChartCard title="Revenue by service type" sub="Where sales are concentrated">
          {byService.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byService} dataKey="total" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {byService.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--sb-surface)', border: '0.5px solid var(--sb-border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v) => fmtUSD(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>No service type data yet.</ChartEmpty>}
        </ChartCard>
      </div>

      <div className="sb-chart-row">
        {/* Referral sources */}
        <ChartCard title="Where leads come from" sub="Revenue by referral source">
          {byReferral.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, byReferral.length * 32)}>
              <BarChart data={byReferral} layout="vertical" margin={{ top: 0, right: 20, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" horizontal={false} />
                <XAxis type="number" stroke="var(--sb-text-muted)" fontSize={11} tickFormatter={v => fmtUSD(v, { short: true })} />
                <YAxis dataKey="name" type="category" stroke="var(--sb-text-muted)" fontSize={11} width={90} />
                <Tooltip
                  contentStyle={{ background: 'var(--sb-surface)', border: '0.5px solid var(--sb-border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v) => fmtUSD(v)}
                />
                <Bar dataKey="total" fill="#0d9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>No referral data yet. Make sure to capture "How did you hear about us?" on every sale.</ChartEmpty>}
        </ChartCard>

        {/* Pipeline by status */}
        <ChartCard title="Pipeline by status" sub="Order count + total value at each stage">
          {byStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byStatus} margin={{ top: 10, right: 10, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" />
                <XAxis dataKey="name" stroke="var(--sb-text-muted)" fontSize={11} angle={-30} textAnchor="end" height={60} />
                <YAxis stroke="var(--sb-text-muted)" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: 'var(--sb-surface)', border: '0.5px solid var(--sb-border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v, n, p) => n === 'count' ? v : fmtUSD(v)}
                />
                <Bar dataKey="count">
                  {byStatus.map((b, i) => <Cell key={i} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <ChartEmpty>Pipeline empty.</ChartEmpty>}
        </ChartCard>
      </div>
    </div>
  )
}

function Metric({ label, value, sub }) {
  return (
    <div className="sb-metric">
      <div className="sb-metric-label">{label}</div>
      <div className="sb-metric-value">{value}</div>
      {sub && <div className="sb-metric-sub">{sub}</div>}
    </div>
  )
}

function ChartCard({ title, sub, children }) {
  return (
    <div className="sb-chart-card">
      <div className="sb-chart-head">
        <div className="sb-chart-title">{title}</div>
        {sub && <div className="sb-chart-sub">{sub}</div>}
      </div>
      <div className="sb-chart-body">{children}</div>
    </div>
  )
}

function ChartEmpty({ children }) {
  return <div className="sb-empty" style={{ minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}

// ── Service type label normalization ──
function serviceLabel(code) {
  const map = {
    'new-stone':    'New Stone',
    'inscription':  'Inscription',
    'acid-wash':    'Acid Wash',
    'repair':       'Repair',
    'mausoleum':    'Mausoleum',
    'cleaning':     'Cleaning',
    'reset':        'Reset',
    'restoration':  'Restoration',
  }
  return map[code] || code
}

function referralLabel(code) {
  const map = {
    'walkin':       'Walk-in',
    'word-of-mouth':'Word of mouth',
    'returning':    'Returning customer',
    'family':       'Family member referral',
    'cemetery':     'Cemetery referral',
    'funeral-home': 'Funeral home',
    'google':       'Google search',
    'social':       'Social media',
    'website':      'Website',
    'sign':         'Yard sign / location',
    'other':        'Other',
  }
  return map[code] || code
}
