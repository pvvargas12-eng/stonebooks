// =============================================================================
// Stonebooks — Profit tab (PROFIT-MATCH-THE-DEMO rebuild)
// =============================================================================
// Rebuilt to literally match the approved demo HTML structure: three layer
// wrappers (LAYER 1 / 2 / 3) each with a bronze eyebrow tag. Data layer
// untouched (one tiny addition: arOver30Count). Honest empty states preserve
// the card rhythm — never fake numbers.
// =============================================================================

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getProfitOverview,
  getFinancialRecords,
  getCemeteryOrders,
  getJobs,
  listAllOrders,
  customerName,
  expenseCategoryLabel,
  paymentMethodLabel,
  PAYMENT_METHODS,
  EXPENSE_CATEGORIES,
  fmtUSD,
  fmtDate,
} from './lib/stonebooksData'
import ExpenseModal from './components/ExpenseModal'
import EstimatesModal from './components/EstimatesModal'

// ─── design tokens (literal hex from the demo spec) ────────────────────────
const C = {
  cardBg: '#ffffff', cardBgCream: '#fafaf7',
  border: 'rgba(0,0,0,0.1)',
  bronze: '#B8860B', bronzeCream: '#fdfaf2',
  textPri: '#0F1419', textSec: '#5f5e5a', textMut: '#8a8a82',
  greenFill: '#1D9E75', greenPillBg: '#EAF3DE', greenPillText: '#3B6D11',
  amberFill: '#EF9F27', amberPillBg: '#FAEEDA', amberPillText: '#854F0B',
  redFill: '#E24B4A', redDeep: '#A32D2D', redPillBg: '#FCEBEB', redPillText: '#791F1F',
  trackGray: '#f1efe8',
}
const TONE_FILL = { green: C.greenFill, amber: C.amberFill, red: C.redFill, neutral: C.textMut }
const TONE_PILL = {
  green:   { bg: C.greenPillBg, text: C.greenPillText },
  amber:   { bg: C.amberPillBg, text: C.amberPillText },
  red:     { bg: C.redPillBg,   text: C.redPillText },
  neutral: { bg: '#eceae4',     text: '#3a3a3a' },
}

// ─── small visual primitives ───────────────────────────────────────────────
function LayerTag({ n, label }) {
  return <div className="px-tag">LAYER {n} · {label}</div>
}

function Sparkline({ data, color }) {
  const nonzero = data.filter(v => v > 0).length
  if (nonzero < 2) return <div className="px-spark-placeholder" />
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => [i / (data.length - 1) * 100, 100 - (v / max) * 100])
  if (nonzero < 8) return (
    <svg className="px-spark" viewBox="0 0 100 100" preserveAspectRatio="none">
      {pts.map(([x, y], i) => data[i] > 0 && <circle key={i} cx={x} cy={y} r="4" fill={color} />)}
    </svg>
  )
  return (
    <svg className="px-spark" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={pts.map(p => p.join(',')).join(' ')} stroke={color} strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SplitBar({ pct, color = C.greenFill }) {
  const w = Math.max(0, Math.min(100, pct || 0))
  return <div className="px-splitbar"><div className="px-splitbar-fill" style={{ width: `${w}%`, background: color }} /></div>
}

function AgingBar({ aging, total }) {
  if (total <= 0) return <div className="px-splitbar" />
  const seg = (v, color) => v > 0 && <div className="px-aging-seg" style={{ width: `${(v / total) * 100}%`, background: color }} />
  return (
    <div className="px-aging">
      {seg(aging.current, C.greenFill)}
      {seg(aging.d30,     C.amberFill)}
      {seg(aging.d60,     C.redFill)}
    </div>
  )
}

function StagePill({ tone, children }) {
  const p = TONE_PILL[tone] || TONE_PILL.neutral
  return <span className="px-stagepill" style={{ background: p.bg, color: p.text }}>{children}</span>
}

function MarginBar({ pct, tone }) {
  const w = pct == null ? 0 : Math.max(2, Math.min(100, pct))
  return <div className="px-mbar"><div className="px-mbar-fill" style={{ width: `${w}%`, background: TONE_FILL[tone] || TONE_FILL.neutral }} /></div>
}

// ─── helpers ────────────────────────────────────────────────────────────────
const pct1 = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
const pct0 = (v) => (v == null ? '—' : `${Math.round(v)}%`)
const rowMarginPct = (r) => (r.realizedPct != null ? r.realizedPct : r.projectedPct)

function monthRangeLabel(now) {
  const month = now.toLocaleDateString('en-US', { month: 'long' })
  return `${month} 1 – ${now.getDate()}, ${now.getFullYear()} · live`
}
function prevMonthLabel(now) {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return prev.toLocaleDateString('en-US', { month: 'long' })
}

// =============================================================================
export default function ProfitTab({ onOpenJob, onOpenCemeteryOrder }) {
  const [ov, setOv] = useState(null)
  const [payments, setPayments] = useState([])
  const [expenses, setExpenses] = useState([])
  const [labels, setLabels] = useState({ cemetery: {}, job: {}, order: {} })
  const [loading, setLoading] = useState(true)

  const [section, setSection] = useState('profitability')
  const [payMethod, setPayMethod] = useState('all')
  const [expCategory, setExpCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [profSort, setProfSort] = useState('worst')
  const [needsOnly, setNeedsOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState('active')
  const [cemFilter, setCemFilter] = useState(null)
  const [typeFilter, setTypeFilter] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [editEstimatesKey, setEditEstimatesKey] = useState(null)
  const [inlineExpenseKey, setInlineExpenseKey] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const rowRefs = useRef({})

  // NOTE: setLoading(false) MUST live in `finally`. A throw anywhere in the
  // try (network, supabase, JS bug) used to leave the page on "Loading…"
  // forever. Each fetch is also guarded individually with Promise.allSettled
  // so one failing query doesn't kill the rest of the page.
  const loadAll = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const results = await Promise.allSettled([
        getProfitOverview(),
        getFinancialRecords({ recordType: 'payment_received' }),
        getFinancialRecords({ recordType: 'expense_incurred' }),
        getCemeteryOrders(),
        getJobs({ includeClosed: true, limit: 500 }),
        listAllOrders(),
      ])
      const [r_ov, r_pays, r_exps, r_cem, r_jobs, r_orders] = results
      const errs = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason))
      if (errs.length) {
        console.warn('[ProfitTab] some loaders failed:', errs)
        setLoadError(errs.join(' · '))
      }
      const overview = r_ov.status === 'fulfilled' ? r_ov.value : null
      const pays     = r_pays.status === 'fulfilled' ? r_pays.value : []
      const exps     = r_exps.status === 'fulfilled' ? r_exps.value : []
      const cemOrders = r_cem.status === 'fulfilled' ? r_cem.value : []
      const jobs      = r_jobs.status === 'fulfilled' ? r_jobs.value : []
      const orders    = r_orders.status === 'fulfilled' ? r_orders.value : []
      // overview.error surfaces a getProfitOverview internal failure
      if (overview?._error) setLoadError(prev => prev || overview._error)
      setOv(overview); setPayments(pays); setExpenses(exps)
      const cem = {}; for (const o of cemOrders) cem[o.id] = `${o.order_number || 'draft'} · ${o.cemetery_name}`
      const job = {}; for (const j of jobs) job[j.id] = j.customer_name || j.deceased_name || j.title || (j.door_index != null ? `Door ${j.door_index + 1}` : `Job ${String(j.id).slice(0, 8)}`)
      const order = {}; for (const o of orders) order[o.id] = customerName(o)
      setLabels({ cemetery: cem, job, order })
    } catch (e) {
      // Defensive — Promise.allSettled never rejects, but any post-processing
      // throw lands here so we still flip out of the loading state.
      console.error('[ProfitTab] loadAll threw:', e)
      setLoadError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!expanded) return
    const h = (e) => { if (e.key === 'Escape') setExpanded(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [expanded])

  const toggleExpand = (key) => {
    setExpanded(prev => {
      const next = prev === key ? null : key
      if (next) requestAnimationFrame(() => {
        const el = rowRefs.current[next]
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 80
          window.scrollTo({ top, behavior: 'smooth' })
        }
      })
      return next
    })
  }
  const openDetail = (r) => {
    const id = r.key.slice(2)
    if (r.kind === 'Cemetery order') onOpenCemeteryOrder?.(id); else onOpenJob?.(id)
  }

  const sourceLabel = (r) =>
    r.cemetery_order_id ? (labels.cemetery[r.cemetery_order_id] || 'Cemetery order')
    : r.job_id ? (labels.job[r.job_id] || 'Job')
    : r.order_id ? (labels.order[r.order_id] || 'Order')
    : 'General overhead'
  const rowLabel = (r) => r.kind === 'Cemetery order' ? r.label : (labels.job[r.key.slice(2)] || r.label || `Job ${r.key.slice(2, 10)}`)
  const rowSubMeta = (r) => r.kind === 'Cemetery order'
    ? `Cemetery order · ${r.jobCount || 0} door${r.jobCount === 1 ? '' : 's'}`
    : `${(r.jobType || 'job').replace(/_/g, ' ')} · ${r.key.slice(2, 10)}`

  const filteredPayments = useMemo(() => payments.filter(p => payMethod === 'all' || p.payment_method === payMethod), [payments, payMethod])
  const filteredExpenses = useMemo(() => expenses.filter(e => expCategory === 'all' || e.category === expCategory), [expenses, expCategory])

  const activeRows = ov?.activeRows || []
  const enrichedRows = useMemo(() => activeRows.map(r => ({ ...r, _label: rowLabel(r), _sub: rowSubMeta(r) })), [activeRows, labels])
  const filteredRows = useMemo(() => {
    let rows = enrichedRows
    if (statusFilter === 'active') rows = rows.filter(r => r.active)
    else if (statusFilter === 'completed') rows = rows.filter(r => !r.active)
    if (cemFilter) rows = rows.filter(r => r.kind === 'Cemetery order' && r.label === cemFilter)
    if (typeFilter) rows = rows.filter(r => r.jobType === typeFilter)
    if (needsOnly) rows = rows.filter(r => r.signals.some(s => s.severity === 'red'))
    const q = search.trim().toLowerCase()
    if (q) rows = rows.filter(r => (r._label || '').toLowerCase().includes(q))
    const val = (r) => { const v = rowMarginPct(r); return v == null ? (profSort === 'worst' ? Infinity : -Infinity) : v }
    if (profSort === 'worst') rows = [...rows].sort((a, b) => val(a) - val(b))
    else if (profSort === 'best') rows = [...rows].sort((a, b) => val(b) - val(a))
    else if (profSort === 'revenue') rows = [...rows].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
    return rows
  }, [enrichedRows, statusFilter, cemFilter, typeFilter, needsOnly, search, profSort])

  if (loading) return <div className="sb-page sb-page-wide px"><div className="sb-page-head"><div className="sb-page-eyebrow">Workspace</div><h1 className="sb-page-title">Profit</h1></div><div className="sb-empty">Loading…</div></div>
  if (!ov) return (
    <div className="sb-page sb-page-wide px">
      <div className="sb-page-head"><div className="sb-page-eyebrow">Workspace</div><h1 className="sb-page-title">Profit</h1></div>
      <div className="px-err">
        <div className="px-err-h">Couldn't load Profit data</div>
        <div className="px-err-b">{loadError || 'Unknown error. Open the browser console for details.'}</div>
        <button className="px-err-btn" onClick={loadAll}>Retry</button>
      </div>
    </div>
  )

  const m = ov.metrics
  const now = new Date()
  const am = m.avgJobMargin

  // ── L1 Card 3 (Net): margin % of monthly revenue (split bar fills that %)
  const netMarginPct = m.revenueMonth > 0 ? (m.netMonth / m.revenueMonth) * 100 : null
  const netTone = netMarginPct == null ? 'neutral' : (netMarginPct < 20 ? 'red' : netMarginPct < 30 ? 'amber' : 'green')

  // ── L2 Cemetery margin-signal callout — synthesize from real data
  const cemTotal = ov.cemeteryRollup.reduce((s, c) => ({ rev: s.rev + c.rev, exp: s.exp + c.exp }), { rev: 0, exp: 0 })
  const shopMarginPct = cemTotal.rev > 0 ? ((cemTotal.rev - cemTotal.exp) / cemTotal.rev) * 100 : null
  const worstCem = ov.cemeteryRollup.slice().filter(c => c.marginPct != null).sort((a, b) => a.marginPct - b.marginPct)[0]
  const worstIsAttn = worstCem && shopMarginPct != null && (worstCem.tone === 'red' || (worstCem.marginPct < shopMarginPct - 10))
  const tripFlagged = worstIsAttn ? enrichedRows.filter(r => r.kind === 'Cemetery order' && r.label === worstCem.name && r.signals.some(s => s.type === 'second_install_trip_not_billed')).length : 0
  const worstCemJobs = worstIsAttn ? enrichedRows.filter(r => r.kind === 'Cemetery order' && r.label === worstCem.name).length : 0

  const activeJobsCount = enrichedRows.filter(r => r.active).length

  return (
    <div className="sb-page sb-page-wide px">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Workspace</div>
        <h1 className="sb-page-title">Profit</h1>
      </div>

      {loadError && (
        <div className="px-err-banner">
          <strong>Partial load:</strong> {loadError} <button className="px-err-banner-btn" onClick={loadAll}>Retry</button>
        </div>
      )}

      {/* ════════════════════════════ LAYER 1 ════════════════════════════ */}
      <section className="px-layer">
        <LayerTag n={1} label="COMPANY NERVOUS SYSTEM" />
        <div className="px-l1-header">
          <h3 className="px-h3">This month at a glance</h3>
          <div className="px-l1-range">{monthRangeLabel(now)}</div>
        </div>

        {/* Row 1 — primary 4 cards */}
        <div className="px-row4">
          <div className="px-card">
            <div className="px-label">Revenue collected</div>
            <div className="px-value">{fmtUSD(m.revenueMonth)}</div>
            <div className="px-sub">
              {m.revenuePrev > 0 ? (
                <span className="px-pos">▲ {Math.round(((m.revenueMonth - m.revenuePrev) / m.revenuePrev) * 100)}% vs {prevMonthLabel(now)}</span>
              ) : <span className="px-mut">First month with revenue</span>}
            </div>
            <Sparkline data={m.revenueSpark} color={C.greenFill} />
          </div>

          <div className="px-card">
            <div className="px-label">Expenses paid</div>
            <div className="px-value">{fmtUSD(m.expensesMonth)}</div>
            <div className="px-sub">
              {m.expensesPrev > 0 ? (
                <span className="px-neg">▲ {Math.round(((m.expensesMonth - m.expensesPrev) / m.expensesPrev) * 100)}% vs {prevMonthLabel(now)}</span>
              ) : <span className="px-mut">First month logged</span>}
            </div>
            <Sparkline data={m.expensesSpark} color={C.redFill} />
          </div>

          <div className="px-card">
            <div className="px-label">Net operational profit</div>
            <div className="px-value" style={{ color: m.netMonth < 0 ? C.redDeep : C.textPri }}>{fmtUSD(m.netMonth)}</div>
            <div className="px-sub">{netMarginPct == null ? <span className="px-mut">No revenue yet this month</span> : <>{pct1(netMarginPct)} margin</>}</div>
            <SplitBar pct={netMarginPct == null ? 0 : Math.max(0, netMarginPct)} color={TONE_FILL[netTone]} />
          </div>

          <div className="px-card">
            <div className="px-label">Outstanding A/R</div>
            <div className="px-value">{fmtUSD(m.arTotal)}</div>
            <div className="px-sub">{m.arTotal > 0 ? `${m.arOver30Count} invoice${m.arOver30Count === 1 ? '' : 's'} > 30 days` : 'No open balances'}</div>
            <AgingBar aging={m.aging} total={m.arTotal} />
          </div>
        </div>

        {/* Row 2 — secondary 4 cards (22px values) */}
        <div className="px-row4 px-row4-sec">
          <div className="px-card">
            <div className="px-label">Cash position</div>
            <div className="px-value-sm">{fmtUSD(m.cashFlow)}</div>
            <div className="px-sub px-mut">Operational · payments − expenses (all-time)</div>
          </div>
          <div className="px-card">
            <div className="px-label">14-day forecast</div>
            <div className="px-value-sm px-mut-val">—</div>
            <div className="px-sub px-mut">Insufficient data — needs payment-date estimates</div>
          </div>
          <div className="px-card">
            <div className="px-label">Overhead burn / month</div>
            <div className="px-value-sm">{fmtUSD(m.overheadBurn)}</div>
            <div className="px-sub px-mut">{m.overheadBurn > 0 ? 'Last 30 days · un-attributed expenses' : 'No overhead logged yet — categorize expenses to track burn'}</div>
          </div>
          <div className="px-card">
            <div className="px-label">Avg job margin</div>
            {am.weightedPct == null ? (
              <><div className="px-value-sm px-mut-val">—</div><div className="px-sub px-mut">No closed jobs with cost actuals yet</div></>
            ) : (
              <><div className="px-value-sm" style={{ color: am.weightedPct < 20 ? C.redDeep : am.weightedPct < 30 ? C.amberPillText : C.greenPillText }}>{pct1(am.weightedPct)}</div><div className="px-sub px-mut">revenue-weighted · median {pct0(am.medianPct)} · {am.n} jobs</div></>
            )}
          </div>
        </div>
      </section>

      {/* ════════════════════════════ LAYER 2 ════════════════════════════ */}
      <section className="px-layer">
        <LayerTag n={2} label="OPERATIONAL ROLLUP" />

        {/* Sub-card A — Profitability by cemetery */}
        <div className="px-sub-card">
          <div className="px-sub-card-head">
            <h3 className="px-h3">Profitability by cemetery</h3>
            <div className="px-meta">All recorded data · click any row to drill in</div>
          </div>
          {ov.cemeteryRollup.length === 0 ? (
            <div className="px-empty">No cemetery orders yet — once submitted, margins appear here.</div>
          ) : (
            <div className="px-cem-rows">
              {ov.cemeteryRollup.map(c => {
                const fillColor = TONE_FILL[c.tone] || TONE_FILL.neutral
                const pctText = c.marginPct == null ? '—' : `${c.marginPct.toFixed(1)}% margin`
                const w = c.marginPct == null ? 0 : Math.max(2, Math.min(100, c.marginPct))
                return (
                  <button key={c.name} className="px-cem-row" onClick={() => { setCemFilter(cemFilter === c.name ? null : c.name); setTypeFilter(null) }}>
                    <div className="px-cem-name">{c.name}</div>
                    <div className="px-cem-track"><div className="px-cem-fill" style={{ width: `${w}%`, background: fillColor }} /></div>
                    <div className="px-cem-pct" style={{ color: fillColor }}>{pctText}</div>
                    <div className="px-cem-meta">{fmtUSD(c.rev)} · {c.jobCount} job{c.jobCount === 1 ? '' : 's'}</div>
                  </button>
                )
              })}
            </div>
          )}

          {/* MARGIN SIGNAL callout — synthesized from real data */}
          {worstIsAttn ? (
            <div className="px-signal-card">
              <div className="px-signal-label">MARGIN SIGNAL</div>
              <div className="px-signal-body">
                {worstCem.name} margin is {worstCem.marginPct.toFixed(1)}% (vs {shopMarginPct.toFixed(1)}% shop-wide across all cemeteries).
                {tripFlagged > 0 ? ` Common factor: ${tripFlagged} of ${worstCemJobs} orders flagged for an unbilled second install trip.` : ''}
              </div>
            </div>
          ) : ov.cemeteryRollup.length > 0 ? (
            <div className="px-signal-card px-signal-ok">
              <div className="px-signal-label" style={{ color: C.greenPillText }}>MARGIN SIGNAL</div>
              <div className="px-signal-body">All cemeteries within {shopMarginPct == null ? 'expected' : `10 pts of ${shopMarginPct.toFixed(1)}% shop-wide`} margin — no anomalies.</div>
            </div>
          ) : null}
        </div>

        {/* Sub-card B — Active jobs · live P&L */}
        <div className="px-sub-card">
          <div className="px-sub-card-head">
            <h3 className="px-h3">Active jobs · live P&amp;L</h3>
            <div className="px-meta">{activeJobsCount} job{activeJobsCount === 1 ? '' : 's'} in production · click to expand</div>
          </div>

          {/* light filters bar (kept compact; demo-aligned) */}
          <div className="px-filters">
            <input className="px-search" placeholder="Search jobs / orders…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="px-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="active">Active</option><option value="completed">Completed</option><option value="all">All</option>
            </select>
            <select className="px-select" value={profSort} onChange={e => setProfSort(e.target.value)}>
              <option value="worst">Margin low → high</option><option value="best">Margin high → low</option><option value="revenue">Revenue</option>
            </select>
            <label className="px-check"><input type="checkbox" checked={needsOnly} onChange={e => setNeedsOnly(e.target.checked)} /> Needs attention</label>
            {(cemFilter || typeFilter) && <button className="px-chip" onClick={() => { setCemFilter(null); setTypeFilter(null) }}>{cemFilter || typeFilter?.replace(/_/g, ' ')} ✕</button>}
          </div>

          {filteredRows.length === 0 ? (
            <div className="px-empty">{needsOnly ? 'Nothing flagged for attention.' : 'No matching jobs or orders.'}</div>
          ) : (
            <table className="px-jobtable">
              <thead>
                <tr>
                  <th className="px-jt-job">Job</th>
                  <th className="px-jt-stage">Stage</th>
                  <th className="px-jt-r">Revenue</th>
                  <th className="px-jt-r">Costs to date</th>
                  <th className="px-jt-r">Margin</th>
                  <th className="px-jt-bar">Trend</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(r => {
                  const mp = rowMarginPct(r)
                  const isOpen = expanded === r.key
                  const lostPts = (r.projectedPct != null && r.realizedPct != null) ? r.projectedPct - r.realizedPct : null
                  return (
                    <Fragment key={r.key}>
                      <tr className={`px-jt-row ${isOpen ? 'on' : ''}`} ref={el => { if (el) rowRefs.current[r.key] = el }} onClick={() => toggleExpand(r.key)}>
                        <td className="px-jt-job">
                          <div className="px-jt-jobname">{r._label}</div>
                          <div className="px-jt-jobmeta">{r._sub}</div>
                        </td>
                        <td className="px-jt-stage"><StagePill tone={r.tone || 'neutral'}>{r.stage}</StagePill></td>
                        <td className="px-jt-r sb-mono">{fmtUSD(r.revenue || 0)}</td>
                        <td className="px-jt-r sb-mono">{fmtUSD(r.cost || 0)}</td>
                        <td className="px-jt-r sb-mono" style={{ color: TONE_FILL[r.tone] || C.textPri }}>{pct1(mp)}</td>
                        <td className="px-jt-bar"><MarginBar pct={mp} tone={r.tone} /></td>
                      </tr>
                      {isOpen && (
                        <tr className="px-l3-tr">
                          <td colSpan={6}>
                            {/* ═════════════ LAYER 3 expanded card ═════════════ */}
                            <div className="px-l3" role="region" aria-label={`${r._label} P&L`}>
                              <LayerTag n={3} label="PER-JOB P&L UNIT" />

                              <div className="px-l3-header">
                                <div className="px-l3-name">{r._label}</div>
                                <StagePill tone={r.tone || 'neutral'}>
                                  {r.tone === 'red' ? 'Margin alert' : r.tone === 'amber' ? 'Watch' : r.tone === 'green' ? 'On track' : 'Tracking'} · {pct1(mp)}
                                </StagePill>
                              </div>

                              <div className="px-l3-sides">
                                {/* Revenue side */}
                                <div className="px-l3-side">
                                  <div className="px-l3-side-label">REVENUE SIDE</div>
                                  <div className="px-l3-side-row"><span>Contract total</span><span className="sb-mono">{r.contract != null ? fmtUSD(r.contract) : '— (no quote)'}</span></div>
                                  <div className="px-l3-side-row"><span>Balance due</span><span className="sb-mono">{r.contract != null ? fmtUSD(r.contract - (r.revenue || 0)) : '—'}</span></div>
                                  <div className="px-l3-side-div" />
                                  <div className="px-l3-side-row px-l3-side-strong"><span>Collected to date</span><span className="sb-mono">{fmtUSD(r.revenue || 0)}</span></div>
                                </div>

                                {/* Cost side */}
                                <div className="px-l3-side">
                                  <div className="px-l3-side-label">COST SIDE</div>
                                  {(!r.actuals || r.actuals.length === 0) ? (
                                    <div className="px-l3-side-empty">No expenses logged yet.</div>
                                  ) : (
                                    r.actuals.map(e => (
                                      <div key={e.id} className="px-l3-side-row">
                                        <span className="px-l3-vendor">{e.vendor || expenseCategoryLabel(e.category)}</span>
                                        <span className="sb-mono px-neg">−{fmtUSD(e.amount)}</span>
                                      </div>
                                    ))
                                  )}
                                  <div className="px-l3-side-div" />
                                  <div className="px-l3-side-row px-l3-side-strong"><span>Total costs</span><span className="sb-mono">{fmtUSD(r.cost || 0)}</span></div>
                                  <button type="button" className="px-l3-add" onClick={(e) => { e.stopPropagation(); setInlineExpenseKey(r.key) }}>+ Add expense</button>
                                </div>
                              </div>

                              {/* 3 margin tiles */}
                              <div className="px-l3-tiles">
                                <div className="px-l3-tile"><div className="px-l3-tile-label">PROJECTED MARGIN AT SALE</div><div className="px-l3-tile-val" style={{ color: C.textSec }}>{pct1(r.projectedPct)}</div></div>
                                <div className="px-l3-tile"><div className="px-l3-tile-label">REALIZED MARGIN NOW</div><div className="px-l3-tile-val" style={{ color: TONE_FILL[r.tone] || C.textPri }}>{pct1(r.realizedPct)}</div></div>
                                <div className="px-l3-tile"><div className="px-l3-tile-label">MARGIN LOST</div><div className="px-l3-tile-val" style={{ color: lostPts != null && lostPts > 0 ? C.redDeep : C.textSec }}>{lostPts == null ? '—' : `${lostPts > 0 ? '−' : '+'}${Math.abs(lostPts).toFixed(1)} pts`}</div></div>
                              </div>

                              {/* WHERE THE MARGIN WENT */}
                              {r.signals.length > 0 ? (
                                <div className="px-signal-card">
                                  <div className="px-signal-label">WHERE THE MARGIN WENT</div>
                                  {r.signals.map((s, i) => (
                                    <div key={i} className="px-signal-body" style={{ marginTop: i ? 8 : 4 }}>
                                      <strong>{s.message}.</strong> {s.evidence}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-signal-card px-signal-ok">
                                  <div className="px-signal-label" style={{ color: C.greenPillText }}>WHERE THE MARGIN WENT</div>
                                  <div className="px-signal-body">Costs tracking estimates — no alerts on this job.</div>
                                </div>
                              )}

                              <div className="px-l3-foot">
                                <button className="px-l3-foot-btn" onClick={(e) => { e.stopPropagation(); setEditEstimatesKey(r.key) }}>Edit estimates</button>
                                <button className="px-l3-foot-btn px-l3-foot-primary" onClick={(e) => { e.stopPropagation(); openDetail(r) }}>View full job →</button>
                                <button className="px-l3-foot-btn" onClick={(e) => { e.stopPropagation(); setExpanded(null) }}>Close</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Job-type rollup — secondary, smaller (keep visible since data layer supplies it) */}
        {ov.jobTypeRollup.length > 0 && (
          <div className="px-sub-card">
            <div className="px-sub-card-head">
              <h3 className="px-h3">Profitability by job type</h3>
              <div className="px-meta">Family jobs only · cemetery door work rolls up to the cemetery rollup above</div>
            </div>
            <div className="px-cem-rows">
              {ov.jobTypeRollup.map(t => {
                const fillColor = TONE_FILL[t.tone] || TONE_FILL.neutral
                const w = t.marginPct == null ? 0 : Math.max(2, Math.min(100, t.marginPct))
                return (
                  <button key={t.jobType} className="px-cem-row" onClick={() => { setTypeFilter(typeFilter === t.jobType ? null : t.jobType); setCemFilter(null) }}>
                    <div className="px-cem-name" style={{ textTransform: 'capitalize' }}>{t.jobType.replace(/_/g, ' ')}</div>
                    <div className="px-cem-track"><div className="px-cem-fill" style={{ width: `${w}%`, background: fillColor }} /></div>
                    <div className="px-cem-pct" style={{ color: fillColor }}>{t.marginPct == null ? '—' : `${t.marginPct.toFixed(1)}% margin`}</div>
                    <div className="px-cem-meta">{fmtUSD(t.rev)} · {t.jobCount} job{t.jobCount === 1 ? '' : 's'}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Ledger sections (Payments / Expenses) preserved below the demo layers ── */}
      <div className="px-tabs">
        {[['profitability', 'Profitability table is above'], ['payments', 'Payments'], ['expenses', 'Expenses']].map(([k, lbl]) => k === 'profitability' ? null : (
          <button key={k} className={`px-tab ${section === k ? 'on' : ''}`} onClick={() => setSection(k)}>{lbl}</button>
        ))}
      </div>

      {section === 'payments' && (
        <div className="px-sub-card">
          <div className="px-sub-card-head"><h3 className="px-h3">Payments</h3><div className="px-meta">{filteredPayments.length} record{filteredPayments.length === 1 ? '' : 's'}</div></div>
          <div className="px-filters">
            <select className="px-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
              <option value="all">All methods</option>
              {PAYMENT_METHODS.map(m2 => <option key={m2.key} value={m2.key}>{m2.label}</option>)}
            </select>
          </div>
          {filteredPayments.length === 0 ? <div className="px-empty">No payments recorded.</div> : (
            <table className="px-jobtable">
              <thead><tr><th>Date</th><th>Source</th><th>Method</th><th className="px-jt-r">Amount</th></tr></thead>
              <tbody>{filteredPayments.map(p => (
                <tr key={p.id} className="px-jt-row"><td className="px-mut">{fmtDate(p.occurred_at)}</td><td>{sourceLabel(p)}</td><td>{paymentMethodLabel(p.payment_method)}{p.payment_reference ? ` · #${p.payment_reference}` : ''}</td><td className="px-jt-r sb-mono">{fmtUSD(p.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {section === 'expenses' && (
        <div className="px-sub-card">
          <div className="px-sub-card-head">
            <h3 className="px-h3">Expenses</h3>
            <div className="px-meta">{filteredExpenses.length} record{filteredExpenses.length === 1 ? '' : 's'}</div>
          </div>
          <div className="px-filters">
            <select className="px-select" value={expCategory} onChange={e => setExpCategory(e.target.value)}>
              <option value="all">All categories</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button className="px-l3-foot-btn px-l3-foot-primary" style={{ marginLeft: 'auto' }} onClick={() => setAddOpen(true)}>+ Add expense</button>
          </div>
          {filteredExpenses.length === 0 ? <div className="px-empty">No expenses recorded.</div> : (
            <table className="px-jobtable">
              <thead><tr><th>Date</th><th>Source</th><th>Category / vendor</th><th className="px-jt-r">Amount</th></tr></thead>
              <tbody>{filteredExpenses.map(e => (
                <tr key={e.id} className="px-jt-row"><td className="px-mut">{fmtDate(e.occurred_at)}</td><td>{sourceLabel(e)}</td><td>{expenseCategoryLabel(e.category)}{e.vendor ? ` · ${e.vendor}` : ''}</td><td className="px-jt-r sb-mono">{fmtUSD(e.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {addOpen && <ExpenseModal showPicker onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); loadAll() }} />}
      {inlineExpenseKey && (() => {
        const r = enrichedRows.find(x => x.key === inlineExpenseKey); if (!r) return null
        const id = r.key.slice(2)
        return <ExpenseModal presetLink={r.kind === 'Cemetery order' ? `cemetery:${id}` : `job:${id}`} presetLabel={r._label} showPicker={false} onClose={() => setInlineExpenseKey(null)} onSaved={() => { setInlineExpenseKey(null); loadAll() }} />
      })()}
      {editEstimatesKey && (() => {
        const r = enrichedRows.find(x => x.key === editEstimatesKey); if (!r) return null
        const id = r.key.slice(2)
        return <EstimatesModal estimateTarget={r.kind === 'Cemetery order' ? { cemeteryOrderId: id } : { jobId: id }} onClose={() => setEditEstimatesKey(null)} onSaved={() => { setEditEstimatesKey(null); loadAll() }} />
      })()}
    </div>
  )
}

// Local React Fragment shim (avoid the import-rename ceremony in this file)
function Fragment({ children }) { return <>{children}</> }

// ─── styles (literal hex from demo spec) ───────────────────────────────────
const styles = `
  .px{ color:#0F1419; }
  .px-tag{ display:inline-block; font-size:9px; font-weight:600; letter-spacing:1.5px; color:#B8860B; background:#fdfaf2; padding:4px 10px; border-radius:4px; margin-bottom:14px; }
  .px-layer{ background:#ffffff; border:.5px solid rgba(0,0,0,0.1); border-radius:12px; padding:20px 22px; margin-top:18px; }
  .px-h3{ font-size:15px; font-weight:600; margin:0; color:#0F1419; }
  .px-meta{ font-size:11px; color:#8a8a82; }

  /* Layer 1 — section header */
  .px-l1-header{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; }
  .px-l1-range{ font-size:11px; color:#8a8a82; letter-spacing:.02em; }

  /* Card grids */
  .px-row4{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .px-row4-sec{ margin-top:12px; }
  .px-card{ background:#fafaf7; border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:6px; min-height:110px; }
  .px-label{ font-size:10px; text-transform:uppercase; color:#8a8a82; letter-spacing:1px; font-weight:600; }
  .px-value{ font-size:26px; font-weight:500; font-variant-numeric:tabular-nums; line-height:1.1; letter-spacing:-.01em; }
  .px-value-sm{ font-size:22px; font-weight:500; font-variant-numeric:tabular-nums; line-height:1.1; letter-spacing:-.01em; }
  .px-mut-val{ color:#8a8a82; }
  .px-sub{ font-size:11px; color:#5f5e5a; min-height:14px; }
  .px-mut{ color:#8a8a82; }
  .px-pos{ color:#3B6D11; font-weight:500; } .px-neg{ color:#791F1F; font-weight:500; }

  .px-spark{ width:100%; height:28px; margin-top:auto; }
  .px-spark-placeholder{ height:28px; background:#f1efe8; border-radius:3px; margin-top:auto; }
  .px-splitbar{ height:4px; border-radius:3px; background:#f1efe8; overflow:hidden; margin-top:auto; }
  .px-splitbar-fill{ height:100%; }
  .px-aging{ display:flex; height:4px; border-radius:3px; background:#f1efe8; overflow:hidden; margin-top:auto; }
  .px-aging-seg{ height:100%; }

  /* Layer 2 — sub-cards */
  .px-sub-card{ background:#ffffff; border:.5px solid rgba(0,0,0,0.1); border-radius:10px; padding:18px 20px; margin-top:14px; }
  .px-sub-card-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; }
  .px-empty{ font-size:13px; color:#8a8a82; padding:14px 0; }

  /* Cemetery / job-type rollup rows */
  .px-cem-rows{ display:flex; flex-direction:column; gap:8px; }
  .px-cem-row{ display:grid; grid-template-columns:180px 1fr 110px auto; align-items:center; gap:14px; width:100%; text-align:left; background:transparent; border:none; padding:6px 0; font:inherit; cursor:pointer; }
  .px-cem-row:hover{ background:#fafaf7; border-radius:6px; padding:6px 8px; }
  .px-cem-name{ font-size:13px; font-weight:500; color:#0F1419; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .px-cem-track{ height:16px; border-radius:3px; background:#f1efe8; overflow:hidden; }
  .px-cem-fill{ height:100%; border-radius:3px; }
  .px-cem-pct{ font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; }
  .px-cem-meta{ font-size:11px; color:#8a8a82; white-space:nowrap; font-variant-numeric:tabular-nums; }

  /* Margin signal callout */
  .px-signal-card{ margin-top:16px; background:#FCEBEB; border-left:3px solid #A32D2D; border-radius:6px; padding:12px 14px; }
  .px-signal-label{ font-size:10px; font-weight:700; letter-spacing:1.2px; color:#791F1F; margin-bottom:4px; }
  .px-signal-body{ font-size:13px; color:#791F1F; line-height:1.5; }
  .px-signal-ok{ background:#EAF3DE; border-left-color:#3B6D11; }
  .px-signal-ok .px-signal-body{ color:#3B6D11; }

  /* Active jobs table */
  .px-filters{ display:flex; align-items:center; gap:10px; margin:6px 0 14px; flex-wrap:wrap; }
  .px-search{ font:inherit; font-size:13px; padding:6px 10px; border:.5px solid rgba(0,0,0,0.15); border-radius:6px; background:#ffffff; min-width:200px; }
  .px-select{ font:inherit; font-size:12.5px; padding:6px 9px; border:.5px solid rgba(0,0,0,0.15); border-radius:6px; background:#ffffff; }
  .px-check{ font-size:12.5px; color:#5f5e5a; display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
  .px-chip{ font-size:11.5px; border:.5px solid #8a8a82; background:#fafaf7; border-radius:999px; padding:3px 10px; cursor:pointer; text-transform:capitalize; }

  .px-jobtable{ width:100%; border-collapse:collapse; }
  .px-jobtable thead th{ font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#8a8a82; font-weight:600; padding:8px 8px 10px; text-align:left; border-bottom:.5px solid rgba(0,0,0,0.1); }
  .px-jobtable .px-jt-r{ text-align:right; }
  .px-jt-row{ cursor:pointer; transition:background .12s; }
  .px-jt-row > td{ padding:10px 8px; border-bottom:.5px solid rgba(0,0,0,0.06); font-size:13px; color:#0F1419; vertical-align:middle; }
  .px-jt-row:hover > td{ background:#fafaf7; }
  .px-jt-row.on > td{ background:#fafaf7; }
  .px-jt-jobname{ font-weight:600; font-size:13.5px; }
  .px-jt-jobmeta{ font-size:11px; color:#8a8a82; margin-top:2px; }
  .px-jt-job{ width:30%; }
  .px-jt-stage{ width:140px; }
  .px-jt-bar{ width:18%; }

  /* Stage pill (proper background, not plain text) */
  .px-stagepill{ display:inline-block; font-size:11px; font-weight:500; padding:3px 8px; border-radius:4px; letter-spacing:.3px; text-transform:capitalize; white-space:nowrap; }

  /* Per-row margin bar */
  .px-mbar{ height:6px; border-radius:3px; background:#f1efe8; overflow:hidden; }
  .px-mbar-fill{ height:100%; border-radius:3px; }

  /* Layer 3 — expanded row */
  .px-l3-tr > td{ padding:0 !important; background:#fafaf7; border-bottom:.5px solid rgba(0,0,0,0.06); }
  .px-l3{ background:#ffffff; border:.5px solid rgba(0,0,0,0.1); border-radius:10px; padding:20px 22px; margin:8px 8px 14px; }
  .px-l3-header{ display:flex; justify-content:space-between; align-items:center; gap:14px; padding-bottom:14px; border-bottom:.5px solid rgba(0,0,0,0.08); }
  .px-l3-name{ font-size:16px; font-weight:600; color:#0F1419; }
  .px-l3-sides{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:16px; }
  .px-l3-side{ background:#fafaf7; border-radius:10px; padding:14px 16px; }
  .px-l3-side-label{ font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#8a8a82; font-weight:600; margin-bottom:10px; }
  .px-l3-side-row{ display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:13px; color:#0F1419; padding:5px 0; }
  .px-l3-side-empty{ font-size:12.5px; color:#8a8a82; padding:4px 0; }
  .px-l3-vendor{ color:#5f5e5a; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%; }
  .px-l3-side-div{ height:.5px; background:rgba(0,0,0,0.1); margin:8px 0; }
  .px-l3-side-strong{ font-weight:600; }
  .px-l3-add{ display:inline-block; background:transparent; border:none; color:#0F1419; font:inherit; font-size:12.5px; font-weight:500; padding:8px 0 0; cursor:pointer; }
  .px-l3-add:hover{ text-decoration:underline; text-underline-offset:3px; }

  .px-l3-tiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:14px; }
  .px-l3-tile{ background:#fafaf7; border-radius:10px; padding:12px 14px; }
  .px-l3-tile-label{ font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#8a8a82; font-weight:600; }
  .px-l3-tile-val{ font-size:22px; font-weight:500; font-variant-numeric:tabular-nums; margin-top:4px; letter-spacing:-.01em; }

  .px-l3-foot{ display:flex; justify-content:flex-end; gap:8px; margin-top:18px; padding-top:14px; border-top:.5px solid rgba(0,0,0,0.08); }
  .px-l3-foot-btn{ border:.5px solid rgba(0,0,0,0.15); background:#ffffff; color:#0F1419; border-radius:6px; padding:7px 14px; font:inherit; font-size:12.5px; cursor:pointer; }
  .px-l3-foot-btn:hover{ background:#fafaf7; }
  .px-l3-foot-primary{ background:#0F1419; color:#ffffff; border-color:transparent; font-weight:500; }
  .px-l3-foot-primary:hover{ opacity:.88; background:#0F1419; color:#ffffff; }

  /* Error UI */
  .px-err{ background:#FCEBEB; border:.5px solid #E24B4A; border-radius:10px; padding:16px 18px; margin-top:18px; }
  .px-err-h{ font-weight:600; color:#791F1F; font-size:14px; }
  .px-err-b{ font-size:12.5px; color:#791F1F; margin-top:6px; word-break:break-word; }
  .px-err-btn{ margin-top:12px; background:#791F1F; color:#fff; border:none; border-radius:6px; padding:7px 14px; font:inherit; font-size:13px; cursor:pointer; }
  .px-err-banner{ background:#FAEEDA; border:.5px solid #EF9F27; border-radius:8px; padding:8px 14px; margin-top:12px; font-size:12.5px; color:#854F0B; display:flex; align-items:center; gap:10px; }
  .px-err-banner-btn{ margin-left:auto; background:transparent; border:.5px solid #854F0B; color:#854F0B; border-radius:4px; padding:3px 10px; font:inherit; font-size:11.5px; cursor:pointer; }

  /* Ledger tabs (Payments / Expenses) below the demo layers */
  .px-tabs{ display:flex; gap:6px; border-bottom:.5px solid rgba(0,0,0,0.1); margin:22px 0 0; }
  .px-tab{ background:none; border:none; border-bottom:2px solid transparent; padding:9px 14px; font:inherit; font-size:13px; color:#5f5e5a; cursor:pointer; margin-bottom:-.5px; font-weight:500; }
  .px-tab.on{ color:#0F1419; border-bottom-color:#B8860B; }

  /* Responsive */
  @media (max-width:1099px){
    .px-row4{ grid-template-columns:repeat(2,1fr); }
    .px-cem-row{ grid-template-columns:120px 1fr 90px auto; }
    .px-l3-sides{ grid-template-columns:1fr; }
    .px-l3-tiles{ grid-template-columns:1fr; }
  }
`
if (typeof document !== 'undefined' && !document.getElementById('px-styles')) {
  const tag = document.createElement('style'); tag.id = 'px-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
