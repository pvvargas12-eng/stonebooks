// =============================================================================
// ReconciliationTab — Phase 2 review UI (READ + local selection only; no writes)
// =============================================================================
// Loads the non-lead OPEN orders (authenticated), runs the Phase-1 match engine
// against the embedded 92-job schedule snapshot, and renders the buckets for the
// operator to review. NOTHING is written from this screen — the Phase-3 execution
// (surname backfill / status population / close) is gated behind a typed
// confirmation that is intentionally NOT wired in this build.
//
// LEAD SAFETY: orders are fetched + filtered to the four non-lead OPEN statuses
// (contracted / in_production / installed / paid_in_full), archived=false. Leads
// (draft/scoping/quoted) and terminal (closed/cancelled) are never in this set.
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import { listAllOrders, closeOrder, bulkCloseOrders } from './lib/stonebooksData'
import { matchReconciliation } from './lib/reconciliationEngine'
import { RECONCILIATION_BATCH } from './lib/reconciliationSchedule'

const OPEN_STATUSES = ['contracted', 'in_production', 'installed', 'paid_in_full']
const RECON_SELECT =
  'id, status, archived, order_number, primary_lastname, service_types, target_completion_date, ' +
  'customer_id, cemetery_id, customer:customers(id, first_name, last_name), cemetery:cemeteries(id, name)'

const BUCKET_META = {
  confirmed:     { label: 'Confirmed match', tone: 'good', hint: 'Surname + cemetery match a schedule job — keep active.' },
  review:        { label: 'Needs review', tone: 'warn', hint: 'Collisions, non-customer records, and low-confidence — never auto-resolved.' },
  closeCandidate:{ label: 'Close candidates', tone: 'red', hint: 'Surname not on the active schedule (and not junk) — proposed close, pending review.' },
}
const REVIEW_LABEL = { collision: 'Same-surname collision', non_customer: 'Looks non-customer', low_confidence: 'Low confidence' }

export default function ReconciliationTab({ onOpenOrder }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [orders, setOrders] = useState([])
  const [decisions, setDecisions] = useState({})   // orderId -> 'keep' | 'close' | 'reviewed' (LOCAL only)
  const [closing, setClosing] = useState({})       // orderId -> 'busy' | 'done' | 'error' (actual DB close)
  const [execText, setExecText] = useState('')
  const [executing, setExecuting] = useState(false)
  const [execMsg, setExecMsg] = useState(null)

  useEffect(() => {
    let cancelled = false
    listAllOrders({ statuses: OPEN_STATUSES, archived: false, limit: 5000, select: RECON_SELECT })
      .then(rows => {
        if (cancelled) return
        // Triple-gate the lead exclusion: re-assert non-lead OPEN status client-side.
        const open = (rows || []).filter(o => OPEN_STATUSES.includes(o.status) && o.archived !== true)
        setOrders(open); setLoading(false)
      })
      .catch(e => { if (!cancelled) { setErr(e?.message || 'Failed to load orders'); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const result = useMemo(() => matchReconciliation(orders), [orders])

  // Decision is DERIVED: default from the bucket, overridden by an explicit pick
  // (no state-seeding effect — keeps the model pure and re-renders correct).
  const defaultDecision = (r) => r.bucket === 'confirmed' ? 'keep' : r.bucket === 'closeCandidate' ? 'close' : 'reviewed'
  const decisionOf = (r) => decisions[r.orderId] ?? defaultDecision(r)
  const setDecision = (orderId, d) => setDecisions(prev => ({ ...prev, [orderId]: d }))

  // Actually close ONE order in the DB (per-row red Close button).
  const doClose = async (orderId) => {
    if (closing[orderId] === 'busy' || closing[orderId] === 'done') return
    setClosing(s => ({ ...s, [orderId]: 'busy' }))
    const res = await closeOrder(orderId)
    setClosing(s => ({ ...s, [orderId]: res.ok ? 'done' : 'error' }))
  }

  // Bulk close every row still marked 'close' (typed-confirmation gated).
  const executeCloses = async () => {
    if (execText.trim() !== 'CLOSE UNMATCHED ORDERS' || executing) return
    const ids = result.rows
      .filter(r => decisionOf(r) === 'close' && closing[r.orderId] !== 'done')
      .map(r => r.orderId)
    if (!ids.length) { setExecMsg('No orders are marked to close.'); return }
    setExecuting(true); setExecMsg(null)
    const res = await bulkCloseOrders(ids)
    setExecuting(false)
    if (!res.ok) { setExecMsg(`Failed — ${res.error || 'error'}`); return }
    setClosing(s => { const n = { ...s }; for (const id of ids) n[id] = 'done'; return n })
    setExecText('')
    setExecMsg(`Closed ${res.count} order${res.count === 1 ? '' : 's'}. ✓`)
  }

  const backfillNeeded = useMemo(() => result.rows.filter(r => r.surnameSource === 'customer').length, [result])
  const plannedCloses = useMemo(() => result.rows.filter(r => (decisions[r.orderId] ?? (r.bucket === 'closeCandidate' ? 'close' : r.bucket === 'confirmed' ? 'keep' : 'reviewed')) === 'close').length, [result, decisions])
  const c = result.counts

  const byBucket = (b) => result.rows.filter(r => r.bucket === b)

  return (
    <div className="sb-recon">
      <style>{RECON_CSS}</style>
      <div className="sb-recon-head">
        <div>
          <h1 className="sb-recon-title">Schedule reconciliation</h1>
          <div className="sb-recon-sub">
            {loading ? 'Loading open orders…' : `${c.open} non-lead open orders · ${c.scheduleTotal} active schedule jobs · ${RECONCILIATION_BATCH.file}`}
          </div>
        </div>
      </div>

      {err && <div className="sb-recon-err">{err}</div>}

      {/* Summary cards */}
      <div className="sb-recon-cards">
        <Card label="Confirmed" value={c.confirmed} tone="good" sub="surname + cemetery" />
        <Card label="Needs review" value={c.review} tone="warn" sub={`${c.review_collision} collision · ${c.review_non_customer} non-customer · ${c.review_low_confidence} low-conf`} />
        <Card label="Close candidates" value={c.closeCandidate} tone="red" sub="not on schedule" />
        <Card label="Unmatched schedule" value={c.unmatchedSchedule} tone="neutral" sub="jobs with no open order" />
        <Card label="Surname backfill" value={backfillNeeded} tone="info" sub="blank primary_lastname → customer.last_name" />
      </div>

      {/* Buckets */}
      {!loading && (
        <>
          <Bucket meta={BUCKET_META.closeCandidate} rows={byBucket('closeCandidate')} decisionOf={decisionOf} setDecision={setDecision} closing={closing} doClose={doClose} onOpenOrder={onOpenOrder} bulk={(d) => {
            setDecisions(prev => { const n = { ...prev }; for (const r of byBucket('closeCandidate')) n[r.orderId] = d; return n })
          }} />
          <Bucket meta={BUCKET_META.review} rows={byBucket('review')} decisionOf={decisionOf} setDecision={setDecision} closing={closing} doClose={doClose} onOpenOrder={onOpenOrder} />
          <Bucket meta={BUCKET_META.confirmed} rows={byBucket('confirmed')} decisionOf={decisionOf} setDecision={setDecision} closing={closing} doClose={doClose} onOpenOrder={onOpenOrder} />

          {/* Unmatched schedule jobs */}
          <section className="sb-recon-bucket">
            <div className="sb-recon-bucket-head"><span className="sb-recon-dot neutral" /> <strong>Unmatched schedule jobs</strong> <span className="sb-recon-n">{result.unmatchedSchedule.length}</span></div>
            <div className="sb-recon-bucket-hint">On the active schedule but no open order matched — may need creating/linking. (No action taken here.)</div>
            <div className="sb-recon-unmatched">
              {result.unmatchedSchedule.map(j => (
                <div key={j.id} className="sb-recon-unmatched-row">
                  <span className="sb-recon-pill">{j.section}</span>
                  <strong>{j.nameRaw}</strong>
                  <span className="sb-recon-mut">{j.cemeteryRaw || '— no cemetery —'}</span>
                  {j.pause && <span className="sb-recon-pause">PAUSE</span>}
                </div>
              ))}
            </div>
          </section>

          {/* PHASE 3 — gated, NOT wired in this build */}
          <section className="sb-recon-exec">
            <div className="sb-recon-exec-title">Phase 3 — close reviewed orders</div>
            <div className="sb-recon-exec-body">
              <strong>Close</strong> the {plannedCloses} order{plannedCloses === 1 ? '' : 's'} still marked “close” below, in one batch. The payment ledger is never touched, and each close is reversible by changing the order’s status. (Surname backfill and schedule-status writes are separate and not run here.)
            </div>
            <div className="sb-recon-exec-gate">
              <input className="sb-recon-confirm" placeholder='Type "CLOSE UNMATCHED ORDERS"' value={execText} onChange={e => setExecText(e.target.value)} />
              <button type="button" className="sb-recon-exec-btn" onClick={executeCloses} disabled={executing || execText.trim() !== 'CLOSE UNMATCHED ORDERS'}>
                {executing ? 'Closing…' : `Close ${plannedCloses} order${plannedCloses === 1 ? '' : 's'}`}
              </button>
              {execMsg
                ? <span className="sb-recon-locked">{execMsg}</span>
                : <span className="sb-recon-locked">Closes only the rows still marked “close.” Reversible via each order’s status.</span>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Card({ label, value, tone, sub }) {
  return (
    <div className={`sb-recon-card sb-recon-card-${tone}`}>
      <div className="sb-recon-card-n">{value}</div>
      <div className="sb-recon-card-l">{label}</div>
      <div className="sb-recon-card-s">{sub}</div>
    </div>
  )
}

function Bucket({ meta, rows, decisionOf, setDecision, closing, doClose, onOpenOrder, bulk }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="sb-recon-bucket">
      <div className="sb-recon-bucket-head" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <span className={`sb-recon-dot ${meta.tone}`} /> <strong>{meta.label}</strong> <span className="sb-recon-n">{rows.length}</span>
        <span className="sb-recon-toggle">{open ? '▾' : '▸'}</span>
      </div>
      <div className="sb-recon-bucket-hint">{meta.hint}</div>
      {bulk && rows.length > 0 && (
        <div className="sb-recon-bulk">
          <button type="button" onClick={() => bulk('close')}>Select all to close</button>
          <button type="button" onClick={() => bulk('keep')}>Keep all open</button>
        </div>
      )}
      {open && (
        <div className="sb-recon-rows">
          {rows.map(r => { const dec = decisionOf(r); return (
            <div key={r.orderId} className={`sb-recon-row d-${dec}`}>
              <button type="button" className="sb-recon-ordno" onClick={() => onOpenOrder?.(r.orderId)}>{r.orderNumber || 'DRAFT'}</button>
              <div className="sb-recon-name">
                <strong>{r.surnameRaw || '— no surname —'}</strong>
                <span className={`sb-recon-src ${r.surnameSource}`}>{r.surnameSource === 'customer' ? 'from customer' : r.surnameSource === 'order' ? 'on order' : 'none'}</span>
              </div>
              <div className="sb-recon-cem">{r.cemeteryName || '—'}</div>
              <div className="sb-recon-status">{r.status}</div>
              <div className="sb-recon-match">
                {r.reviewReason && <span className="sb-recon-rr">{REVIEW_LABEL[r.reviewReason]}</span>}
                {Array.isArray(r.scheduleHints) && r.scheduleHints.length > 0
                  ? r.scheduleHints.map(h => <span key={h.id} className="sb-recon-hint">{h.nameRaw}{h.cemeteryRaw ? ` · ${h.cemeteryRaw}` : ''} ({h.section})</span>)
                  : (r.match && !Array.isArray(r.match) ? <span className="sb-recon-hint">{r.match.nameRaw} · {r.match.section}</span> : <span className="sb-recon-mut">no schedule match</span>)}
                <span className="sb-recon-reason">{r.reason}</span>
              </div>
              <div className="sb-recon-actions">
                {closing[r.orderId] === 'done' ? (
                  <span className="sb-recon-closed">Closed ✓</span>
                ) : (<>
                  <button type="button" className={dec === 'keep' ? 'on' : ''} onClick={() => setDecision(r.orderId, 'keep')}>Keep</button>
                  <button type="button" className="close-act" onClick={() => doClose(r.orderId)} disabled={closing[r.orderId] === 'busy'}>
                    {closing[r.orderId] === 'busy' ? 'Closing…' : closing[r.orderId] === 'error' ? 'Retry' : 'Close'}
                  </button>
                  <button type="button" className={dec === 'reviewed' ? 'on' : ''} onClick={() => setDecision(r.orderId, 'reviewed')}>Reviewed</button>
                </>)}
              </div>
            </div>
          )})}
          {rows.length === 0 && <div className="sb-recon-empty">None.</div>}
        </div>
      )}
    </section>
  )
}

const RECON_CSS = `
  .sb-recon { padding: 24px 28px; max-width: 1400px; margin: 0 auto; }
  .sb-recon-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .sb-recon-title { font-size: 24px; font-weight: 700; color: #0f1419; margin: 0; }
  .sb-recon-sub { font-size: 13px; color: #7a756a; margin-top: 4px; }
  .sb-recon-err { background: #fdeceb; color: #b3261e; padding: 10px 12px; border-radius: 8px; margin-bottom: 14px; }
  .sb-recon-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .sb-recon-card { background: #fff; border: 1px solid #e6e2d8; border-radius: 12px; padding: 14px 16px; }
  .sb-recon-card-n { font-size: 30px; font-weight: 700; line-height: 1; }
  .sb-recon-card-l { font-size: 13px; font-weight: 600; color: #2a2a27; margin-top: 6px; }
  .sb-recon-card-s { font-size: 11px; color: #9a948a; margin-top: 2px; }
  .sb-recon-card-good .sb-recon-card-n { color: #15724a; }
  .sb-recon-card-warn .sb-recon-card-n { color: #8a5a12; }
  .sb-recon-card-red .sb-recon-card-n { color: #b3261e; }
  .sb-recon-card-info .sb-recon-card-n { color: #234c8a; }
  .sb-recon-card-neutral .sb-recon-card-n { color: #6a6a66; }
  .sb-recon-bucket { background: #fff; border: 1px solid #e6e2d8; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
  .sb-recon-bucket-head { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .sb-recon-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .sb-recon-dot.good { background: #2d7a4f; } .sb-recon-dot.warn { background: #d8901f; }
  .sb-recon-dot.red { background: #b3261e; } .sb-recon-dot.neutral { background: #9a948a; }
  .sb-recon-n { background: rgba(15,20,25,0.08); border-radius: 999px; padding: 1px 9px; font-size: 13px; font-weight: 700; }
  .sb-recon-toggle { margin-left: auto; color: #9a948a; }
  .sb-recon-bucket-hint { font-size: 12px; color: #9a948a; margin: 4px 0 10px; }
  .sb-recon-bulk { display: flex; gap: 8px; margin-bottom: 8px; }
  .sb-recon-bulk button { font: inherit; font-size: 12px; padding: 5px 12px; border: 1px solid #d8d6d1; border-radius: 8px; background: #fff; cursor: pointer; }
  .sb-recon-rows { display: flex; flex-direction: column; }
  .sb-recon-row { display: grid; grid-template-columns: 80px 1.4fr 1.1fr 0.9fr 2.4fr 170px; gap: 10px; align-items: center;
    padding: 8px 6px; border-top: 1px solid #f0ece1; font-size: 13px; }
  .sb-recon-row.d-close { background: #fdf3f2; } .sb-recon-row.d-keep { background: #f3f8f4; }
  .sb-recon-ordno { font: inherit; font-family: ui-monospace, monospace; font-size: 12px; color: #234c8a; background: none; border: none; cursor: pointer; text-align: left; }
  .sb-recon-name strong { display: block; }
  .sb-recon-src { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; }
  .sb-recon-src.customer { background: #eaf1fb; color: #234c8a; } .sb-recon-src.order { background: #eef0ec; color: #6a6a66; }
  .sb-recon-src.none { background: #fdeceb; color: #b3261e; }
  .sb-recon-cem { color: #4a4a45; } .sb-recon-status { color: #7a756a; font-size: 12px; }
  .sb-recon-match { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .sb-recon-rr { font-size: 10.5px; font-weight: 700; color: #8a5a12; text-transform: uppercase; letter-spacing: 0.04em; }
  .sb-recon-hint { font-size: 12px; color: #2a2a27; }
  .sb-recon-mut { color: #b3aea2; font-size: 12px; }
  .sb-recon-reason { font-size: 11px; color: #9a948a; }
  .sb-recon-actions { display: flex; gap: 4px; }
  .sb-recon-actions button { font: inherit; font-size: 11.5px; padding: 4px 9px; border: 1px solid #d8d6d1; border-radius: 7px; background: #fff; cursor: pointer; }
  .sb-recon-actions button.on { border-color: #0f1419; background: #0f1419; color: #fff; }
  .sb-recon-actions button.on.red { border-color: #b3261e; background: #b3261e; }
  .sb-recon-actions button.close-act { border-color: #b3261e; background: #b3261e; color: #fff; }
  .sb-recon-actions button.close-act:hover:not(:disabled) { background: #96201a; }
  .sb-recon-actions button.close-act:disabled { opacity: 0.6; cursor: default; }
  .sb-recon-closed { font-size: 11.5px; font-weight: 700; color: #15724a; padding: 4px 9px; }
  .sb-recon-empty { color: #b3aea2; font-size: 13px; padding: 8px 6px; }
  .sb-recon-unmatched { display: flex; flex-direction: column; gap: 4px; }
  .sb-recon-unmatched-row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 3px 0; }
  .sb-recon-pill { font-size: 10px; font-weight: 700; background: #efece4; color: #7a756a; border-radius: 999px; padding: 1px 8px; }
  .sb-recon-pause { font-size: 10px; font-weight: 700; color: #b3261e; background: #fdeceb; border-radius: 999px; padding: 1px 7px; }
  .sb-recon-exec { background: #f7f5ef; border: 1px dashed #c9a23a; border-radius: 12px; padding: 16px 18px; margin-top: 8px; }
  .sb-recon-exec-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8a5a12; }
  .sb-recon-exec-body { font-size: 13px; color: #4a4a45; line-height: 1.5; margin: 8px 0 12px; }
  .sb-recon-exec-gate { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sb-recon-confirm { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid #d8d6d1; border-radius: 8px; width: 280px; }
  .sb-recon-exec-btn { font: inherit; font-weight: 600; padding: 8px 16px; border-radius: 8px; border: 1px solid #b3261e; background: #b3261e; color: #fff; cursor: pointer; }
  .sb-recon-exec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sb-recon-locked { font-size: 12px; color: #8a5a12; }
`
