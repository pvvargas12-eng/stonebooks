// =============================================================================
// Stonebooks — Profit tab (operational P&L foundation)
// =============================================================================
// Four month-to-date cards (Revenue · Expenses · Net · Owed to you) over three
// sections: Profitability (default), Payments, Expenses. Profitability grain
// follows the Monument Operations Architect review — one row per cemetery
// ORDER, one row per family JOB (cemetery door-jobs roll up to their order).
// Charts / forecasting / CSV-PDF export are explicit follow-ups, not built here.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getFinancialRecords,
  getPaymentsTotal,
  getExpensesTotal,
  getOutstandingReceivable,
  getCemeteryOrderPnL,
  getJobPnL,
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

const monthRange = () => {
  const n = new Date()
  return {
    start: new Date(n.getFullYear(), n.getMonth(), 1).toISOString(),
    end: new Date(n.getFullYear(), n.getMonth() + 1, 1).toISOString(),   // half-open
  }
}
const rowMarginPct = (r) => (r.realizedPct != null ? r.realizedPct : r.projectedPct)
const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(0)}%`)

export default function ProfitTab() {
  const [section, setSection] = useState('profitability')   // default-land per IA review
  const [cards, setCards] = useState({ revenue: 0, expenses: 0, owed: 0 })
  const [payments, setPayments] = useState([])
  const [expenses, setExpenses] = useState([])
  const [profitRows, setProfitRows] = useState([])
  const [labels, setLabels] = useState({ cemetery: {}, job: {}, order: {} })
  const [loading, setLoading] = useState(true)

  // filters
  const [payMethod, setPayMethod] = useState('all')
  const [expCategory, setExpCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [profSort, setProfSort] = useState('worst')   // worst | best margin first
  const [needsOnly, setNeedsOnly] = useState(false)    // only rows with red signals

  const loadAll = useCallback(async () => {
    setLoading(true)
    const mr = monthRange()
    const [revenue, expTotal, owed, pays, exps, cemOrders, jobs, orders] = await Promise.all([
      getPaymentsTotal({ dateRange: mr }),
      getExpensesTotal({ dateRange: mr }),
      getOutstandingReceivable(),
      getFinancialRecords({ recordType: 'payment_received' }),
      getFinancialRecords({ recordType: 'expense_incurred' }),
      getCemeteryOrders(),
      getJobs({ includeClosed: true, limit: 500 }),
      listAllOrders(),
    ])
    setCards({ revenue, expenses: expTotal, owed })
    setPayments(pays); setExpenses(exps)

    // label maps
    const cemMap = {}; for (const o of cemOrders) cemMap[o.id] = `${o.order_number || 'draft'} · ${o.cemetery_name}`
    const jobMap = {}; const jobById = {}
    for (const j of jobs) {
      jobById[j.id] = j
      jobMap[j.id] = j.customer_name || j.deceased_name || j.title || (j.door_index != null ? `Door ${j.door_index + 1}` : `Job ${String(j.id).slice(0, 8)}`)
    }
    const orderMap = {}; for (const o of orders) orderMap[o.id] = customerName(o)
    setLabels({ cemetery: cemMap, job: jobMap, order: orderMap })

    // ── profitability rows (only entities with ledger activity) ────────────
    const allRecs = [...pays, ...exps]
    const cemActivity = new Set()
    const familyJobActivity = new Set()
    for (const r of allRecs) {
      if (r.cemetery_order_id) cemActivity.add(r.cemetery_order_id)
      if (r.job_id) {
        const j = jobById[r.job_id]
        if (j && j.cemetery_order_id) cemActivity.add(j.cemetery_order_id)  // door-job expense → rolls to order
        else familyJobActivity.add(r.job_id)
      }
    }
    const flat = (key, kind, label, pnl) => ({
      key, kind, label,
      revenue: pnl.revenue.payments_collected,
      contract: pnl.revenue.contract_total,
      cost: pnl.costs.total_actual,
      projectedPct: pnl.margin.projected_pct,
      realizedPct: pnl.margin.realized_pct,
      signals: pnl.signals,
      needsAttention: pnl.signals.some(s => s.severity === 'red'),
      hasSignal: pnl.signals.length > 0,
    })
    const rows = []
    for (const id of cemActivity) {
      const p = await getCemeteryOrderPnL(id)
      if (p) rows.push(flat(`c:${id}`, 'Cemetery order', cemMap[id] || `Order ${String(id).slice(0, 8)}`, p))
    }
    for (const id of familyJobActivity) {
      const p = await getJobPnL(id)
      if (p) rows.push(flat(`j:${id}`, 'Job', jobMap[id] || `Job ${String(id).slice(0, 8)}`, p))
    }
    setProfitRows(rows)
    setLoading(false)
  }, [])

  useEffect(() => { let c = false; loadAll().then(() => { if (c) setLoading(true) }); return () => { c = true } }, [loadAll])

  const sourceLabel = (r) =>
    r.cemetery_order_id ? (labels.cemetery[r.cemetery_order_id] || 'Cemetery order')
    : r.job_id ? (labels.job[r.job_id] || 'Job')
    : r.order_id ? (labels.order[r.order_id] || 'Order')
    : 'General overhead'

  const filteredPayments = useMemo(
    () => payments.filter(p => payMethod === 'all' || p.payment_method === payMethod),
    [payments, payMethod])
  const filteredExpenses = useMemo(
    () => expenses.filter(e => expCategory === 'all' || e.category === expCategory),
    [expenses, expCategory])
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q ? profitRows.filter(r => r.label.toLowerCase().includes(q)) : profitRows.slice()
    if (needsOnly) rows = rows.filter(r => r.needsAttention)
    const val = (r) => { const v = rowMarginPct(r); return v == null ? (profSort === 'worst' ? Infinity : -Infinity) : v }
    rows.sort((a, b) => profSort === 'worst' ? val(a) - val(b) : val(b) - val(a))   // worst = lowest margin first
    return rows
  }, [profitRows, search, needsOnly, profSort])

  const net = cards.revenue - cards.expenses

  return (
    <div className="sb-page sb-page-wide pf">
      <div className="sb-page-head">
        <div className="sb-page-eyebrow">Workspace</div>
        <h1 className="sb-page-title">Profit</h1>
      </div>

      {/* Month-to-date cards */}
      <div className="pf-cards">
        <Card label="Revenue" sub="this month" value={fmtUSD(cards.revenue)} />
        <Card label="Expenses" sub="this month" value={fmtUSD(cards.expenses)} />
        <Card label="Net" sub="this month" value={fmtUSD(net)} tone={net >= 0 ? 'pos' : 'neg'} />
        <Card label="Owed to you" sub="open balances" value={fmtUSD(cards.owed)} />
      </div>

      {/* Section switch */}
      <div className="pf-tabs">
        {[['profitability', 'Profitability'], ['payments', 'Payments'], ['expenses', 'Expenses']].map(([k, lbl]) => (
          <button key={k} className={`pf-tab ${section === k ? 'on' : ''}`} onClick={() => setSection(k)}>{lbl}</button>
        ))}
      </div>

      {loading ? <div className="sb-empty">Loading…</div> : (
        <>
          {section === 'profitability' && (
            <>
              <div className="pf-filters">
                <input className="pf-search" placeholder="Search jobs / orders…" value={search} onChange={e => setSearch(e.target.value)} />
                <label className="pf-filter">Sort
                  <select value={profSort} onChange={e => setProfSort(e.target.value)}>
                    <option value="worst">Margin: low → high</option>
                    <option value="best">Margin: high → low</option>
                  </select>
                </label>
                <label className="pf-check"><input type="checkbox" checked={needsOnly} onChange={e => setNeedsOnly(e.target.checked)} /> Needs attention</label>
              </div>
              {filteredRows.length === 0 ? (
                <div className="sb-empty">{needsOnly ? 'No jobs or orders are flagged for attention.' : 'No profitability data yet. It populates as estimates, payments and expenses are recorded.'}</div>
              ) : (
                <div className="pf-table">
                  <div className="pf-row pf-head pf-prof"><div>Source</div><div className="pf-r">Collected</div><div className="pf-r">Cost</div><div className="pf-r">Margin</div><div>Signals</div></div>
                  {filteredRows.map(r => {
                    const mp = rowMarginPct(r)
                    return (
                      <div key={r.key} className={`pf-row pf-prof ${r.needsAttention ? 'pf-attn' : ''}`}>
                        <div className="pf-src"><span className="pf-kind">{r.kind}</span>{r.label}</div>
                        <div className="pf-r sb-mono">{fmtUSD(r.revenue || 0)}</div>
                        <div className="pf-r sb-mono">{fmtUSD(r.cost || 0)}</div>
                        <div className={`pf-r sb-mono ${mp != null && mp < 20 ? 'pf-neg' : ''}`}>{fmtPct(mp)}<span className="pf-mp-kind">{r.realizedPct != null ? ' real' : (r.projectedPct != null ? ' proj' : '')}</span></div>
                        <div className="pf-sig">
                          {r.signals.length === 0 ? <span className="pf-muted">—</span>
                            : r.signals.map((s, i) => <span key={i} className={`pf-dot pf-dot-${s.severity}`} title={s.evidence}>{s.message}</span>)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {section === 'payments' && (
            <>
              <div className="pf-filters">
                <label className="pf-filter">Method
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                    <option value="all">All</option>
                    {PAYMENT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </label>
              </div>
              {filteredPayments.length === 0 ? <div className="sb-empty">No payments recorded.</div> : (
                <div className="pf-table">
                  <div className="pf-row pf-head pf-ledger"><div>Date</div><div>Source</div><div>Method</div><div className="pf-r">Amount</div></div>
                  {filteredPayments.map(p => (
                    <div key={p.id} className="pf-row pf-ledger">
                      <div className="pf-muted">{fmtDate(p.occurred_at)}</div>
                      <div className="pf-src">{sourceLabel(p)}</div>
                      <div>{paymentMethodLabel(p.payment_method)}{p.payment_reference ? ` · #${p.payment_reference}` : ''}</div>
                      <div className="pf-r sb-mono">{fmtUSD(p.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {section === 'expenses' && (
            <>
              <div className="pf-filters">
                <label className="pf-filter">Category
                  <select value={expCategory} onChange={e => setExpCategory(e.target.value)}>
                    <option value="all">All</option>
                    {EXPENSE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
                <button className="pf-add" onClick={() => setAddOpen(true)}>Add expense</button>
              </div>
              {filteredExpenses.length === 0 ? <div className="sb-empty">No expenses recorded.</div> : (
                <div className="pf-table">
                  <div className="pf-row pf-head pf-ledger"><div>Date</div><div>Source</div><div>Category / vendor</div><div className="pf-r">Amount</div></div>
                  {filteredExpenses.map(e => (
                    <div key={e.id} className="pf-row pf-ledger">
                      <div className="pf-muted">{fmtDate(e.occurred_at)}</div>
                      <div className="pf-src">{sourceLabel(e)}</div>
                      <div>{expenseCategoryLabel(e.category)}{e.vendor ? ` · ${e.vendor}` : ''}</div>
                      <div className="pf-r sb-mono">{fmtUSD(e.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {addOpen && (
        <ExpenseModal showPicker onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); loadAll() }} />
      )}
    </div>
  )
}

function Card({ label, sub, value, tone }) {
  return (
    <div className="pf-card">
      <div className="pf-card-label">{label}</div>
      <div className={`pf-card-value ${tone === 'neg' ? 'pf-neg' : tone === 'pos' ? 'pf-pos' : ''}`}>{value}</div>
      <div className="pf-card-sub">{sub}</div>
    </div>
  )
}

const styles = `
  .pf-cards{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0 22px; }
  .pf-card{ border:.5px solid var(--sb-border); border-radius:10px; padding:16px 18px; background:var(--sb-surface); }
  .pf-card-label{ font-size:12px; color:var(--sb-text-muted); }
  .pf-card-value{ font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; margin-top:6px; }
  .pf-card-sub{ font-size:11px; color:var(--sb-text-muted); margin-top:3px; text-transform:uppercase; letter-spacing:.04em; }
  .pf-pos{ color:#2d7a4f; } .pf-neg{ color:#b54040; }
  .pf-tabs{ display:flex; gap:6px; border-bottom:.5px solid var(--sb-border); margin-bottom:16px; }
  .pf-tab{ background:none; border:none; border-bottom:2px solid transparent; padding:8px 12px; font:inherit; font-size:13.5px; color:var(--sb-text-muted); cursor:pointer; margin-bottom:-.5px; }
  .pf-tab.on{ color:var(--sb-text); border-bottom-color:var(--sb-accent,#b8842a); font-weight:500; }
  .pf-search{ font:inherit; font-size:13px; padding:8px 12px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-surface); color:var(--sb-text); width:280px; max-width:100%; margin-bottom:14px; }
  .pf-filters{ display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .pf-filter{ display:inline-flex; align-items:center; gap:8px; font-size:12px; color:var(--sb-text-muted); }
  .pf-filter select{ font:inherit; font-size:13px; padding:7px 10px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-surface); color:var(--sb-text); }
  .pf-add{ margin-left:auto; border:.5px solid var(--sb-border); background:var(--sb-text); color:var(--sb-bg); border-radius:6px; padding:8px 16px; font:inherit; font-size:13px; cursor:pointer; }
  .pf-add:hover{ opacity:.88; }
  .pf-table{ display:flex; flex-direction:column; gap:6px; }
  .pf-row{ display:grid; grid-template-columns:minmax(180px,2fr) 1fr 1fr 1fr 70px; align-items:center; gap:14px; background:var(--sb-surface); border:.5px solid var(--sb-border); border-radius:8px; padding:11px 16px; font-size:13px; }
  .pf-row.pf-ledger{ grid-template-columns:110px minmax(180px,2fr) 1fr 120px; }
  .pf-head{ background:transparent; border:none; padding:0 16px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--sb-text-muted); }
  .pf-r{ text-align:right; font-variant-numeric:tabular-nums; }
  .pf-muted{ color:var(--sb-text-muted); }
  .pf-src{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pf-kind{ display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--sb-text-muted); background:var(--sb-surface-muted); border-radius:3px; padding:1px 6px; margin-right:8px; }
  .pf-row.pf-prof{ grid-template-columns:minmax(180px,2fr) 1fr 1fr 96px minmax(150px,1.6fr); }
  .pf-attn{ border-color:#e3a3a3; }
  .pf-mp-kind{ font-size:10px; color:var(--sb-text-muted); }
  .pf-check{ display:inline-flex; align-items:center; gap:6px; font-size:12.5px; color:var(--sb-text-muted); cursor:pointer; }
  .pf-sig{ display:flex; flex-wrap:wrap; gap:4px; }
  .pf-dot{ font-size:10.5px; border-radius:4px; padding:2px 7px; white-space:nowrap; cursor:default; }
  .pf-dot-red{ background:#fbe9e9; color:#b54040; border:.5px solid #e3a3a3; }
  .pf-dot-amber{ background:#fbe9d6; color:#9a5b1a; border:.5px solid #e7c98f; }
`
if (typeof document !== 'undefined' && !document.getElementById('pf-styles')) {
  const tag = document.createElement('style'); tag.id = 'pf-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
