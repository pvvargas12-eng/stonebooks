// =============================================================================
// Stonebooks — Edit cost estimates modal (shared)
// =============================================================================
// 6 numeric inputs (one per ESTIMATE_CATEGORIES), live sum, prefilled from
// existing estimates. Save upserts all six via setJobCostEstimate (per-target,
// per-category). Used by JobPnLPanel and the Profit-tab expanded-row footer.
// =============================================================================

import { useState, useEffect } from 'react'
import {
  getJobCostEstimates,
  setJobCostEstimate,
  ESTIMATE_CATEGORIES,
  fmtUSD,
} from '../lib/stonebooksData'

export default function EstimatesModal({ estimateTarget, onClose, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(ESTIMATE_CATEGORIES.map(c => [c.key, ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let c = false
    getJobCostEstimates(estimateTarget).then(rows => {
      if (c) return
      const next = Object.fromEntries(ESTIMATE_CATEGORIES.map(cat => [cat.key, '']))
      for (const r of rows) next[r.category] = String(r.estimated_amount)
      setVals(next)
    })
    return () => { c = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateTarget?.jobId, estimateTarget?.cemeteryOrderId])

  const sum = ESTIMATE_CATEGORIES.reduce((s, c) => s + (Number(vals[c.key]) || 0), 0)

  const save = async () => {
    setBusy(true); setError(null)
    for (const { key } of ESTIMATE_CATEGORIES) {
      const amt = Number(vals[key]) || 0
      const res = await setJobCostEstimate({ ...estimateTarget, category: key, estimatedAmount: amt })
      if (!res.ok) { setError(res.error); setBusy(false); return }
    }
    onSaved?.()
  }

  return (
    <div className="em-bg" onClick={() => !busy && onClose?.()}>
      <div className="em-modal" onClick={e => e.stopPropagation()}>
        <h3 className="em-title">Edit cost estimates</h3>
        <p className="em-sub">Quote-time cost assumptions. Drives projected margin.</p>
        {ESTIMATE_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="em-field">{label}
            <input type="number" step="0.01" min="0" value={vals[key]}
              onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))} placeholder="0.00" />
          </label>
        ))}
        <div className="estm-sum">Sum: <strong className="sb-mono">{fmtUSD(sum)}</strong></div>
        {error && <div className="em-error">{error}</div>}
        <div className="em-actions">
          <button className="em-btn" disabled={busy} onClick={() => onClose?.()}>Cancel</button>
          <button className="em-btn em-btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save estimates'}</button>
        </div>
      </div>
    </div>
  )
}

// Reuses ExpenseModal's em-* styles (loaded when any expense modal mounts).
// Adds only the per-modal extras here.
const styles = `
  .estm-sum{ text-align:right; font-size:13px; margin:6px 0 14px; color:var(--sb-text-muted); }
`
if (typeof document !== 'undefined' && !document.getElementById('estm-styles')) {
  const tag = document.createElement('style'); tag.id = 'estm-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
