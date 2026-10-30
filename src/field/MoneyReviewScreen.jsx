// =============================================================================
// MoneyReviewScreen — Reports › Monthly review, on the phone (Paul 2026-10-30:
// "in Stonebooks Field I want the financial reports built and visible … only
// my SB Field"). Owner tile gated to Paul alone in MoreScreen.
// =============================================================================
// The SAME component the desktop renders (OwnerReviewView: growth by month,
// statements in the cabinet, the written owner reviews with scores) over the
// same bundle, with a phone-fit stylesheet layered on top so nothing leaks
// past the screen edge. One truth, two screens.
// =============================================================================
import { useState, useEffect } from 'react'
import { loadReportsData } from '../lib/reportsData'
import OwnerReviewView from '../components/OwnerReviewView'

export default function MoneyReviewScreen({ who, onBack }) {
  const [now] = useState(() => new Date())
  const [bundle, setBundle] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let c = false
    loadReportsData().then(b => { if (!c) setBundle(b) }).catch(e => { if (!c) setErr(e?.message || 'Could not load the numbers.') })
    return () => { c = true }
  }, [])

  return (
    <div className="fl-money-review">
      <style>{FIT_CSS}</style>
      {onBack && (
        <button type="button" className="fl-rowline" onClick={onBack}
          style={{ color: '#9A7209', fontWeight: 700, fontSize: 15, minHeight: 44 }}>
          &#8249; Menu
        </button>
      )}
      <div className="fl-greet" style={{ fontSize: 29 }}>Money review</div>
      <div className="fl-greet-sub">Growth month by month, the statements in the cabinet, the owner reviews — the same page as Reports on the desktop</div>
      {err && <div className="fl-empty">{err}</div>}
      {!err && bundle === null && <div className="fl-empty">Adding it up&#8230;</div>}
      {!err && bundle && (
        <div style={{ marginTop: 12 }}>
          <OwnerReviewView bundle={bundle} now={now} user={{ email: who?.name || null }} />
        </div>
      )}
    </div>
  )
}

// Phone fit for the desktop view: tighter padding, one tile per row, the
// tables scroll inside their boxes (never the page), the review card stacks.
const FIT_CSS = `
  .fl-money-review { min-width: 0; }
  .fl-money-review .orv { gap: 14px; }
  .fl-money-review .orv-sec { padding: 12px 12px; border-radius: 12px; }
  .fl-money-review .orv-h2 { font-size: 16px; }
  .fl-money-review .orv-sub { font-size: 12px; }
  .fl-money-review .orv-tiles { grid-template-columns: 1fr 1fr; gap: 8px; }
  .fl-money-review .orv-tile-v { font-size: 18px; }
  .fl-money-review .orv-table { font-size: 12px; }
  .fl-money-review .orv-table th, .fl-money-review .orv-table td { padding: 7px 6px; }
  .fl-money-review .orv-drill td { padding: 10px 8px 12px; }
  .fl-money-review .orv-buckets { grid-template-columns: 1fr; }
  .fl-money-review .orv-card-top { flex-direction: column; align-items: stretch; }
  .fl-money-review .orv-score { align-self: flex-start; }
  .fl-money-review .orv-card-btns { width: 100%; }
  .fl-money-review .orv-card-btns .orv-btn { flex: 1 1 auto; text-align: center; }
  .fl-money-review .orv-form-row { grid-template-columns: 1fr; }
  .fl-money-review .orv-form-foot { flex-direction: column; align-items: stretch; }
  .fl-money-review .orv-form-btns { justify-content: flex-end; }
  .fl-money-review .orv-trend { flex-direction: column; align-items: stretch; gap: 6px; }
  .fl-money-review .orv-trend-k { padding-bottom: 0; }
  .fl-money-review .orv-btn { min-height: 40px; }
`
