// =============================================================================
// Stonebooks — Job / Cemetery-order P&L panel
// =============================================================================
// The per-unit operational P&L surface (replaces the old JobExpensesPanel).
// Shared by JobDetail (target={{ jobId }}) and CemeteryOrderDetail
// (target={{ cemeteryOrderId }}). Renders margin tiles, revenue + cost cards
// (Est | Actual | Variance), rule-based variance signals, and the estimates
// editor. Expenses are added via the shared ExpenseModal.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import {
  getJobPnL,
  getCemeteryOrderPnL,
  ESTIMATE_CATEGORIES,
  estimateCategoryLabel,
  fmtUSD,
} from './lib/stonebooksData'
import ExpenseModal from './components/ExpenseModal'
import EstimatesModal from './components/EstimatesModal'

// Margin tone thresholds (Paul Q4): red if realized < projected×0.5 OR < 20 abs;
// amber if realized < projected×0.7 OR < 30 abs; else green.
function marginTone(projected, realized) {
  if (realized == null) return 'neutral'
  if ((projected != null && realized < projected * 0.5) || realized < 20) return 'red'
  if ((projected != null && realized < projected * 0.7) || realized < 30) return 'amber'
  return 'green'
}
const pct = (n) => (n == null ? '—' : `${n.toFixed(0)}%`)

export default function JobPnLPanel({ target, label = 'this job' }) {
  const jobId = target?.jobId || null
  const cemId = target?.cemeteryOrderId || null
  const isJob = !!jobId
  const targetId = jobId || cemId
  const [pnl, setPnl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [estOpen, setEstOpen] = useState(false)
  const [expOpen, setExpOpen] = useState(false)

  const reload = useCallback(async () => {
    const p = jobId ? await getJobPnL(jobId) : await getCemeteryOrderPnL(cemId)
    setPnl(p); setLoading(false)
  }, [jobId, cemId])

  useEffect(() => { let c = false; reload().then(() => { if (c) setLoading(true) }); return () => { c = true } }, [reload])

  if (!targetId) return null
  if (loading) return <div className="pnl"><div className="pnl-empty">Loading P&L…</div></div>
  if (!pnl) return null

  const { revenue, costs, margin, signals } = pnl
  const tone = marginTone(margin.projected_pct, margin.realized_pct)

  return (
    <div className="pnl">
      <div className="pnl-head">
        <h3 className="pnl-title">Profit &amp; loss</h3>
        <div className="pnl-actions">
          <button className="pnl-btn pnl-btn-ghost" onClick={() => setEstOpen(true)}>Edit estimates</button>
          <button className="pnl-btn pnl-btn-primary" onClick={() => setExpOpen(true)}>+ Add expense</button>
        </div>
      </div>

      {/* Margin tiles */}
      <div className="pnl-tiles">
        <div className="pnl-tile"><span>Projected margin</span><strong>{pct(margin.projected_pct)}</strong><em>{margin.projected_dollar != null ? fmtUSD(margin.projected_dollar) : '—'}</em></div>
        <div className={`pnl-tile pnl-tone-${tone}`}><span>Realized margin</span><strong>{pct(margin.realized_pct)}</strong><em>{margin.realized_dollar != null ? fmtUSD(margin.realized_dollar) : '—'}</em></div>
        <div className="pnl-tile"><span>Margin lost</span><strong>{margin.lost_pct == null ? '—' : `${margin.lost_pct > 0 ? '' : '+'}${(-margin.lost_pct).toFixed(0)}%`}</strong><em>vs projected</em></div>
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div className="pnl-signals">
          {signals.map((s, i) => (
            <div key={i} className={`pnl-signal pnl-sig-${s.severity}`}>
              <div className="pnl-sig-msg">{s.message}</div>
              <div className="pnl-sig-ev">{s.evidence}</div>
            </div>
          ))}
        </div>
      )}

      <div className="pnl-cards">
        {/* Revenue */}
        <div className="pnl-card">
          <div className="pnl-card-h">Revenue</div>
          <Row label="Contract total" value={revenue.contract_total != null ? fmtUSD(revenue.contract_total) : '— (no quote)'} />
          <Row label="Deposit" value={fmtUSD(revenue.deposit)} />
          <Row label="Collected to date" value={fmtUSD(revenue.payments_collected)} />
          <Row label="Balance due" value={revenue.balance_due != null ? fmtUSD(revenue.balance_due) : '—'} strong />
        </div>

        {/* Costs */}
        <div className="pnl-card">
          <div className="pnl-card-h pnl-cost-h"><span>Cost</span><span className="pnl-r">Est</span><span className="pnl-r">Actual</span><span className="pnl-r">Var</span></div>
          {ESTIMATE_CATEGORIES.map(({ key }) => {
            const c = costs.byCategory[key] || { estimated: 0, actual: 0, variance: 0 }
            const varClass = c.variance > 0 ? 'pnl-over' : (c.variance < 0 ? 'pnl-under' : '')
            return (
              <div key={key} className="pnl-cost-row">
                <span>{estimateCategoryLabel(key)}</span>
                <span className="pnl-r sb-mono">{fmtUSD(c.estimated)}</span>
                <span className="pnl-r sb-mono">{fmtUSD(c.actual)}</span>
                <span className={`pnl-r sb-mono ${varClass}`}>{c.variance > 0 ? '+' : ''}{fmtUSD(c.variance)}</span>
              </div>
            )
          })}
          <div className="pnl-cost-row pnl-cost-total">
            <span>Total</span>
            <span className="pnl-r sb-mono">{fmtUSD(costs.total_estimated)}</span>
            <span className="pnl-r sb-mono">{fmtUSD(costs.total_actual)}</span>
            <span className={`pnl-r sb-mono ${costs.total_actual - costs.total_estimated > 0 ? 'pnl-over' : 'pnl-under'}`}>{costs.total_actual - costs.total_estimated > 0 ? '+' : ''}{fmtUSD(costs.total_actual - costs.total_estimated)}</span>
          </div>
        </div>
      </div>

      {estOpen && (
        <EstimatesModal
          estimateTarget={isJob ? { jobId } : { cemeteryOrderId: cemId }}
          onClose={() => setEstOpen(false)}
          onSaved={() => { setEstOpen(false); reload() }}
        />
      )}
      {expOpen && (
        <ExpenseModal
          presetLink={isJob ? `job:${jobId}` : `cemetery:${cemId}`}
          presetLabel={label}
          showPicker={false}
          onClose={() => setExpOpen(false)}
          onSaved={() => { setExpOpen(false); reload() }}
        />
      )}
    </div>
  )
}

function Row({ label, value, strong }) {
  return <div className={`pnl-rev-row ${strong ? 'pnl-rev-strong' : ''}`}><span>{label}</span><span className="sb-mono">{value}</span></div>
}

// EstimatesModal lives in src/components/EstimatesModal.jsx (shared with ProfitTab).

const styles = `
  .pnl{ border:.5px solid var(--sb-border); border-radius:10px; padding:18px 20px; margin-top:18px; background:var(--sb-surface); }
  .pnl-empty{ font-size:13px; color:var(--sb-text-muted); }
  .pnl-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .pnl-title{ font-size:15px; font-weight:600; margin:0; }
  .pnl-actions{ display:flex; gap:8px; align-items:center; }
  .pnl-btn{ border:.5px solid var(--sb-border); background:var(--sb-surface); color:var(--sb-text); border-radius:6px; padding:7px 14px; font:inherit; font-size:12.5px; cursor:pointer; }
  .pnl-btn:hover{ background:var(--sb-surface-muted); }
  .pnl-btn-ghost{ background:transparent; }
  .pnl-btn-primary{ background:var(--sb-text); color:var(--sb-bg); border-color:transparent; font-weight:500; }
  .pnl-btn-primary:hover{ opacity:.88; background:var(--sb-text); }
  .pnl-tiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; }
  .pnl-tile{ border:.5px solid var(--sb-border); border-radius:8px; padding:12px 14px; }
  .pnl-tile span{ font-size:11px; color:var(--sb-text-muted); text-transform:uppercase; letter-spacing:.04em; }
  .pnl-tile strong{ display:block; font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; margin-top:4px; }
  .pnl-tile em{ font-style:normal; font-size:12px; color:var(--sb-text-muted); }
  .pnl-tone-green strong{ color:#2d7a4f; } .pnl-tone-amber strong{ color:#b8842a; } .pnl-tone-red strong{ color:#b54040; }
  .pnl-tone-amber{ border-color:#e7c98f; } .pnl-tone-red{ border-color:#e3a3a3; }
  .pnl-signals{ display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
  .pnl-signal{ border-radius:8px; padding:10px 14px; border:.5px solid; }
  .pnl-sig-red{ background:#fbe9e9; border-color:#e3a3a3; }
  .pnl-sig-amber{ background:#fbe9d6; border-color:#e7c98f; }
  .pnl-sig-msg{ font-weight:600; font-size:13px; color:var(--sb-text); }
  .pnl-sig-ev{ font-size:12px; color:var(--sb-text-secondary); margin-top:2px; }
  .pnl-cards{ display:grid; grid-template-columns:1fr 1.4fr; gap:12px; }
  .pnl-card{ border:.5px solid var(--sb-border); border-radius:8px; padding:14px 16px; }
  .pnl-card-h{ font-size:13px; font-weight:600; margin-bottom:8px; }
  .pnl-cost-h{ display:grid; grid-template-columns:1.3fr 1fr 1fr 1fr; gap:8px; }
  .pnl-rev-row{ display:flex; justify-content:space-between; font-size:13px; padding:4px 0; color:var(--sb-text-secondary); }
  .pnl-rev-strong{ border-top:.5px solid var(--sb-border); margin-top:4px; padding-top:8px; font-weight:600; color:var(--sb-text); }
  .pnl-cost-row{ display:grid; grid-template-columns:1.3fr 1fr 1fr 1fr; gap:8px; font-size:13px; padding:4px 0; color:var(--sb-text-secondary); }
  .pnl-cost-total{ border-top:.5px solid var(--sb-border); margin-top:4px; padding-top:8px; font-weight:600; color:var(--sb-text); }
  .pnl-r{ text-align:right; font-variant-numeric:tabular-nums; }
  .pnl-over{ color:#b54040; } .pnl-under{ color:#2d7a4f; }
  .pnl-estsum{ text-align:right; font-size:13px; margin:6px 0 14px; color:var(--sb-text-muted); }
`
if (typeof document !== 'undefined' && !document.getElementById('pnl-styles')) {
  const tag = document.createElement('style'); tag.id = 'pnl-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
