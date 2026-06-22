// =============================================================================
// Stonebooks — Cemetery Order Detail
// =============================================================================
// Detail view for a cemetery order: PO summary, per-door breakdown, linked
// mausoleum_door jobs (milestone progress), packet download, printable PO, and
// the payment surface. Production status and PAYMENT status are shown
// separately — payment is computed live from the financial_records ledger
// (an order is "paid in full" when recorded payments >= total_amount).
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  getCemeteryOrder,
  getJobsForCemeteryOrder,
  getCemeteryPricingForOrder,
  getDoorPrice,
  getCemeteryPacketSignedUrl,
  getFinancialRecords,
  recordPayment, updateFinancialRecord, voidFinancialRecord,
  setCemeteryOrderQuoteStatus, appendQuoteEvent, getCurrentStaffName,
  PAYMENT_METHODS,
  paymentMethodLabel,
  fmtUSD,
  fmtDate,
  fmtRelative,
} from './lib/stonebooksData'
import { ReceiptActions, SALES_REPS } from './SalesMode'
import ReceiptPreviewModal from './components/ReceiptPreviewModal'
import JobPnLPanel from './JobPnLPanel'
import JobDimensionsPanel from './JobDimensionsPanel'
import QuoteStatusBlock from './components/QuoteStatusBlock'

// Production lifecycle (NOT payment — payment is computed separately).
const CO_STATUS = {
  draft:         { label: 'Draft',          color: '#8b8f95' },
  submitted:     { label: 'Submitted',      color: '#b8842a' },
  in_production: { label: 'In production',  color: '#534AB7' },
  completed:     { label: 'Completed',      color: '#2d7a4f' },
  invoiced:      { label: 'Invoiced',       color: '#1D9E75' },
  cancelled:     { label: 'Cancelled',      color: '#b54040' },
  paid:          { label: 'Completed',      color: '#2d7a4f' },  // legacy rows: 'paid' was a status; show as completed
}
const PAY_PILL = {
  unpaid:  { label: 'Unpaid',       color: '#b54040' },
  partial: { label: 'Partial',      color: '#b8842a' },
  paid:    { label: 'Paid in full', color: '#2d7a4f' },
}
const keyOf = (s) => (typeof s === 'string' ? s : s?.key)
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function CemeteryOrderDetail({ orderId, onBack, onOpenJob, onResumeDraft, onEditOrder }) {
  const [order, setOrder] = useState(null)
  const [jobs, setJobs] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)

  const [payOpen, setPayOpen] = useState(false)
  const [pay, setPay] = useState({ amount: '', method: 'check', reference: '', date: todayISO(), notes: '', collectedBy: '' })
  const [savingPay, setSavingPay] = useState(false)
  const [lastReceiptId, setLastReceiptId] = useState(null)   // just-saved financial_record id → post-save receipt
  const [receiptPreview, setReceiptPreview] = useState(null) // { payment } → click-to-preview modal
  const [editPay, setEditPay] = useState(null)               // { id, amount, method, date, reference } inline editor
  const [payRowBusy, setPayRowBusy] = useState(null)
  const [payRowErr, setPayRowErr] = useState(null)

  const reload = useCallback(async () => {
    const [o, js, pays] = await Promise.all([
      getCemeteryOrder(orderId),
      getJobsForCemeteryOrder(orderId),
      getFinancialRecords({ recordType: 'payment_received', cemeteryOrderId: orderId }),
    ])
    setOrder(o); setJobs(js || []); setPayments(pays || []); setLoading(false)
    return o
  }, [orderId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    reload().then(() => { if (cancelled) setLoading(true) })
    return () => { cancelled = true }
  }, [reload])

  const pricing = useMemo(() => (order ? getCemeteryPricingForOrder(order) : null), [order])
  const isSplit = pricing?.type === 'indoor_outdoor_split'
  const itemMapFor = (d) => (isSplit ? (d.location ? (pricing[d.location] || {}) : {}) : (pricing?.items || {}))

  if (loading) return <div className="sb-page sb-page-wide"><div className="sb-empty">Loading order…</div></div>
  if (!order) return <div className="sb-page sb-page-wide"><button className="cod-back" onClick={onBack}>← Back</button><div className="sb-empty">Order not found.</div></div>

  const st = CO_STATUS[order.status] || { label: order.status, color: '#8b8f95' }
  const doors = order.doors || []

  // ── live payment state from the ledger (voided rows EXCLUDED) ────────────
  const total = Number(order.total_amount || 0)
  const livePayments = payments.filter(p => !p.voided)
  const paidTotal = livePayments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const balance = Math.max(0, total - paidTotal)
  const payState = total > 0 && paidTotal >= total ? 'paid' : (paidTotal > 0 ? 'partial' : 'unpaid')

  // ── cemetery → receipt adapter (real fields only; cemetery orders carry no
  // billing street address and no deceased, so those are omitted, not faked).
  const frToPayment = (fr) => ({
    id: fr.id, amount: fr.amount, method: fr.payment_method, ref: fr.payment_reference,
    receivedAt: (fr.occurred_at || '').slice(0, 10), createdBy: fr.created_by, locked: true, voided: false,
  })
  const receiptOrder = {
    orderNumber: order.order_number,
    signedAt: order.submitted_at || null,
    targetCompletionDate: null,
    customer: { firstName: '', lastName: order.cemetery_name || 'Cemetery', email: order.cemetery_contact_email || '', phonePrimary: order.cemetery_contact_phone || '' },
    deceased: [],
    payments: livePayments.map(frToPayment),
  }
  const lastReceiptPayment = lastReceiptId ? receiptOrder.payments.find(p => p.id === lastReceiptId) : null
  const payPill = PAY_PILL[payState]
  const isCancelled = order.status === 'cancelled'
  const canRecordPayment = !isCancelled && total > 0 && balance > 0

  const downloadPacket = async () => {
    const url = await getCemeteryPacketSignedUrl(order.packet_storage_path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const sendCemQuote = async () => {
    const r = await setCemeteryOrderQuoteStatus(order.id, 'pending_review')
    if (r.ok) { await appendQuoteEvent('cemetery_orders', order.id, { type: 'sent', by: await getCurrentStaffName() }); await reload() }
    return r
  }

  // Edit: drafts resume the wizard at Step 1; submitted orders reopen it in
  // edit mode (lands on the doors editor — Phase 7).
  const onEdit = () => {
    if (order.status === 'draft') onResumeDraft?.(order.id)
    else onEditOrder?.(order.id)
  }

  // ── record payment ──────────────────────────────────────────────────────
  const openPay = async () => {
    const me = await getCurrentStaffName().catch(() => '')
    setPay({ amount: balance > 0 ? balance.toFixed(2) : '', method: 'check', reference: '', date: todayISO(), notes: '', collectedBy: me || '' })
    setPayOpen(true)
  }
  const payAmt = Number(pay.amount)
  const payValid = Number.isFinite(payAmt) && payAmt > 0
  const overpay = payValid && payAmt > balance + 0.005
  const afterPaid = paidTotal + (payValid ? payAmt : 0)
  const submitPay = async () => {
    if (!payValid) return
    setSavingPay(true)
    const createdBy = pay.collectedBy || await getCurrentStaffName().catch(() => null)
    const res = await recordPayment({
      amount: payAmt,
      paymentMethod: pay.method,
      paymentReference: pay.reference.trim() || null,
      occurredAt: pay.date ? new Date(`${pay.date}T12:00:00`).toISOString() : undefined,
      cemeteryOrderId: order.id,
      notes: pay.notes.trim() || null,
      createdBy,
    })
    await reload()
    setSavingPay(false); setPayOpen(false)
    if (res?.ok && res.record) setLastReceiptId(res.record.id)   // ⭐ offer Print + Email right after save
  }

  // ── Edit / void a cemetery payment (incl. amount; NO edit-trail) ─────────
  const startEditPay = (p) => {
    setPayRowErr(null)
    setEditPay({ id: p.id, amount: String(p.amount ?? ''), method: p.payment_method || 'check', date: (p.occurred_at || '').slice(0, 10), reference: p.payment_reference || '' })
  }
  const saveEditPay = async () => {
    if (!editPay) return
    setPayRowBusy(editPay.id); setPayRowErr(null)
    const res = await updateFinancialRecord(editPay.id, {
      amount: Number(editPay.amount), payment_method: editPay.method,
      payment_reference: editPay.reference.trim() || null,
      occurred_at: editPay.date ? new Date(`${editPay.date}T12:00:00`).toISOString() : undefined,
    })
    setPayRowBusy(null)
    if (!res.ok) { setPayRowErr(res.error || 'Could not save the edit.'); return }
    setEditPay(null); await reload()
  }
  const voidPay = async (p) => {
    const reason = window.prompt('Void this payment? Enter a reason (kept for the record):')
    if (reason == null) return
    if (!reason.trim()) { setPayRowErr('A reason is required to void a payment.'); return }
    setPayRowBusy(p.id); setPayRowErr(null)
    const by = await getCurrentStaffName().catch(() => null)
    const res = await voidFinancialRecord(p.id, { reason: reason.trim(), by })
    setPayRowBusy(null)
    if (!res.ok) { setPayRowErr(res.error || 'Could not void the payment.'); return }
    await reload()
  }

  return (
    <div className="sb-page sb-page-wide cod">
      <button className="cod-back" onClick={onBack}>← All cemetery orders</button>

      {/* PO summary header */}
      <div className="cod-head">
        <div>
          <div className="sb-page-eyebrow">Cemetery order</div>
          <h1 className="sb-page-title sb-mono">{order.order_number || 'DRAFT'}</h1>
          <div className="cod-sub">{order.cemetery_name}</div>
        </div>
        <div className="cod-head-right">
          <div className="cod-pills">
            <span className="cod-pill cod-pill-status" style={{ '--pill-color': st.color }}>{st.label}</span>
            <span className="cod-pill cod-pill-pay" style={{ '--pill-color': payPill.color }}>
              {payPill.label}{payState === 'partial' ? ` · ${fmtUSD(balance)} due` : ''}
            </span>
          </div>
          <div className="cod-total">{total ? fmtUSD(total) : '—'}</div>
          {payState !== 'unpaid' && <div className="cod-paidline">{fmtUSD(paidTotal)} received{balance > 0 ? ` · ${fmtUSD(balance)} due` : ''}</div>}
        </div>
      </div>

      <div className="cod-meta">
        <span>Created {fmtDate(order.created_at)}</span>
        {order.submitted_at && <span>· Submitted {fmtDate(order.submitted_at)}</span>}
        <span>· Updated {fmtRelative(order.updated_at)}</span>
        {(order.tax_applied || order.cc_fee_applied) && (
          <span>· {[order.tax_applied ? 'NJ tax' : null, order.cc_fee_applied ? 'CC fee' : null].filter(Boolean).join(' + ')} applied</span>
        )}
      </div>

      {/* Quote Hub — crypt / mausoleum door orders go through owner approval too */}
      <div className="cod-quote" style={{ margin: '4px 0 16px' }}>
        <QuoteStatusBlock status={order.quote_status} onSend={sendCemQuote} disabled={order.status === 'draft'} hint="Submit the order before sending it for quote approval." />
      </div>

      <div className="cod-actions">
        <button className="cod-btn" onClick={onEdit}>Edit order</button>
        {canRecordPayment && <button className="cod-btn cod-btn-primary" onClick={openPay}>Record payment</button>}
        <button className="cod-btn" onClick={() => window.print()}>Print PO</button>
        {order.packet_storage_path && <button className="cod-btn" onClick={downloadPacket}>Packet</button>}
      </div>

      {/* Doors */}
      <h2 className="cod-h2">Doors ({doors.length})</h2>
      {doors.map((d, i) => {
        const map = itemMapFor(d)
        return (
          <div key={i} className="cod-door">
            <div className="cod-door-head">
              <strong>Door {i + 1}</strong>
              {isSplit && d.location && <span className="cod-loc">{d.location}</span>}
              <span className="cod-door-sub">{fmtUSD(getDoorPrice(d, pricing))}</span>
            </div>
            <div className="cod-door-items">
              {(d.selectedItems || []).map(s => {
                const k = keyOf(s)
                const ov = (s && typeof s === 'object' && s.price_override != null) ? Number(s.price_override) : null
                return (
                  <div key={k} className="cod-li">
                    <span>{map[k]?.label || k}</span>
                    <span className="sb-mono">{ov != null ? fmtUSD(ov) : fmtUSD(map[k]?.price || 0)}{ov != null ? ' *' : ''}</span>
                  </div>
                )
              })}
            </div>
            {d.inscriptionText && <div className="cod-inscr">“{d.inscriptionText}”</div>}
            {d.notes && <div className="cod-notes">Note: {d.notes}</div>}
          </div>
        )
      })}

      {/* Per-order P&L: estimates, actuals, margin, variance signals */}
      <JobPnLPanel target={{ cemeteryOrderId: order.id }} label={order.cemetery_name} />

      {/* Dimensional tags (sales rep + referral source) */}
      <JobDimensionsPanel
        target={{ cemeteryOrderId: order.id }}
        initial={{ sales_rep_id: order.sales_rep_id, referral_source: order.referral_source }}
        onSaved={reload}
      />

      {/* Payments */}
      <h2 className="cod-h2">Payments ({livePayments.length})</h2>

      {/* ⭐ Just-recorded payment — Print + Email + Download right after save. */}
      {lastReceiptPayment && (
        <div style={{ margin: '8px 0', padding: '10px 12px', background: '#e6f4ec', border: '0.5px solid #2d7a4f', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2d7a4f', marginBottom: 4 }}>Payment recorded — receipt</div>
          <ReceiptActions order={receiptOrder} payment={lastReceiptPayment} grandTotalOverride={total} />
          <button type="button" className="cod-btn" style={{ marginTop: 6 }} onClick={() => setLastReceiptId(null)}>Dismiss</button>
        </div>
      )}

      {payments.length === 0 ? (
        <div className="sb-empty">No payments recorded yet.{canRecordPayment ? ' Use “Record payment” above.' : ''}</div>
      ) : (
        <div className="cod-pays">
          {payments.map(p => (editPay?.id === p.id ? (
            <div key={p.id} className="cod-payrow" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input type="number" className="cod-input" value={editPay.amount} onChange={e => setEditPay(s => ({ ...s, amount: e.target.value }))} placeholder="Amount" />
              <select className="cod-input" value={editPay.method} onChange={e => setEditPay(s => ({ ...s, method: e.target.value }))}>
                {PAYMENT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <input type="date" className="cod-input" value={editPay.date} onChange={e => setEditPay(s => ({ ...s, date: e.target.value }))} />
              <input type="text" className="cod-input" value={editPay.reference} onChange={e => setEditPay(s => ({ ...s, reference: e.target.value }))} placeholder={editPay.method === 'zelle' ? 'Zelle confirmation #' : 'Reference / check #'} />
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button type="button" className="cod-btn cod-btn-primary" disabled={payRowBusy === p.id} onClick={saveEditPay}>{payRowBusy === p.id ? 'Saving…' : 'Save'}</button>
                <button type="button" className="cod-btn" onClick={() => setEditPay(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div key={p.id} className="cod-payrow" style={{ cursor: 'pointer', ...(p.voided ? { opacity: 0.55 } : {}) }}
              title="View receipt"
              onClick={() => setReceiptPreview({ payment: p.voided ? { ...frToPayment(p), voided: true, voidedBy: p.voided_by, voidedReason: p.voided_reason } : frToPayment(p) })}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span className="cod-pay-l">
                    <span className="cod-pay-amt sb-mono" style={p.voided ? { textDecoration: 'line-through' } : undefined}>{fmtUSD(p.amount)}</span>
                    <span className="cod-pay-method">{paymentMethodLabel(p.payment_method)}</span>
                    {p.payment_reference && <span className="cod-pay-ref">#{p.payment_reference}</span>}
                    {p.voided && <span style={{ color: '#b54040', fontWeight: 700, fontSize: 11 }}>VOIDED</span>}
                  </span>
                  <span className="cod-pay-r">
                    {fmtDate(p.occurred_at)}
                    {!p.voided && <>
                      {' · '}<button type="button" className="cod-linkbtn" onClick={e => { e.stopPropagation(); startEditPay(p) }}>Edit</button>
                      {' · '}<button type="button" className="cod-linkbtn" onClick={e => { e.stopPropagation(); voidPay(p) }}>Void</button>
                    </>}
                  </span>
                </div>
                {p.voided && p.voided_reason && <div className="cod-pay-note">Voided{p.voided_by ? ` by ${p.voided_by}` : ''}: {p.voided_reason}</div>}
                {!p.voided && <div onClick={e => e.stopPropagation()}><ReceiptActions order={receiptOrder} payment={frToPayment(p)} grandTotalOverride={total} /></div>}
              </div>
            </div>
          )))}
          {payRowErr && <div className="sb-empty" style={{ color: '#b54040', padding: '6px 16px' }}>{payRowErr}</div>}
          <div className="cod-payrow cod-paytotal">
            <div className="cod-pay-l"><span className="cod-pay-amt sb-mono">{fmtUSD(paidTotal)}</span><span className="cod-pay-method">received of {fmtUSD(total)}</span></div>
            <div className="cod-pay-r">{balance > 0 ? `${fmtUSD(balance)} outstanding` : 'Paid in full'}</div>
          </div>
        </div>
      )}

      {/* Linked jobs */}
      <h2 className="cod-h2">Production jobs ({jobs.length})</h2>
      {jobs.length === 0 ? (
        <div className="sb-empty">No jobs yet — this order hasn't been submitted to production.</div>
      ) : (
        <div className="cod-jobs">
          {jobs.map(j => {
            const ms = j.milestones || []
            const totalM = ms.length
            const done = ms.filter(m => m.status === 'done').length
            const next = ms.slice().sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
              .find(m => m.status !== 'done' && m.status !== 'not_needed')
            const pct = totalM ? Math.round((done / totalM) * 100) : 0
            return (
              <button key={j.id} className="cod-job" onClick={() => onOpenJob?.(j.id)}>
                <div className="cod-job-l">
                  <div className="cod-job-title">Door {j.door_index != null ? j.door_index + 1 : '—'}</div>
                  <div className="cod-job-next">{next ? `Next: ${next.label}` : 'All milestones complete'}</div>
                </div>
                <div className="cod-job-r">
                  <div className="cod-prog"><div className="cod-prog-bar" style={{ width: `${pct}%` }} /></div>
                  <div className="cod-job-meta">{done} of {totalM} · {fmtRelative(j.last_update_at)}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Record-payment modal */}
      {payOpen && (
        <div className="cod-modal-bg" onClick={() => !savingPay && setPayOpen(false)}>
          <div className="cod-modal" onClick={e => e.stopPropagation()}>
            <h3 className="cod-modal-title">Record payment</h3>
            <p className="cod-modal-body">
              <strong className="sb-mono">{order.order_number || 'This order'}</strong> · {fmtUSD(balance)} outstanding of {fmtUSD(total)}.
            </p>
            <label className="cod-modal-field">Amount
              <input type="number" step="0.01" min="0" value={pay.amount} autoFocus onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} />
            </label>
            <label className="cod-modal-field">Method
              <select value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))}>
                {PAYMENT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="cod-modal-field">Payment collected by
              <select value={pay.collectedBy} onChange={e => setPay(p => ({ ...p, collectedBy: e.target.value }))}>
                {(pay.collectedBy && !SALES_REPS.includes(pay.collectedBy)) && <option value={pay.collectedBy}>{pay.collectedBy}</option>}
                <option value="">— select —</option>
                {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="cod-modal-field">Reference (optional)
              <input value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} placeholder="Check # / confirmation" />
            </label>
            <label className="cod-modal-field">Date
              <input type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} />
            </label>
            <label className="cod-modal-field">Notes (optional)
              <textarea rows={2} value={pay.notes} onChange={e => setPay(p => ({ ...p, notes: e.target.value }))} />
            </label>
            {payValid && (
              <div className={`cod-consequence ${overpay ? 'warn' : ''}`}>
                {overpay
                  ? `Exceeds balance by ${fmtUSD(payAmt - balance)} — record anyway?`
                  : afterPaid >= total ? 'This clears the balance.' : `${fmtUSD(total - afterPaid)} will remain.`}
              </div>
            )}
            <div className="cod-modal-actions">
              <button className="cod-btn" disabled={savingPay} onClick={() => setPayOpen(false)}>Cancel</button>
              <button className="cod-btn cod-btn-primary" disabled={savingPay || !payValid} onClick={submitPay}>{savingPay ? 'Saving…' : 'Record payment'}</button>
            </div>
          </div>
        </div>
      )}

      {receiptPreview && (
        <ReceiptPreviewModal order={receiptOrder} payment={receiptPreview.payment} grandTotalOverride={total} onClose={() => setReceiptPreview(null)} />
      )}

      {/* print-only PO */}
      <div className="cod-print">
        <div className="cod-ppo-lh">
          <div>
            <div className="cod-ppo-name">SHEVCHENKO MONUMENTS</div>
            <div className="cod-ppo-estd">Family-owned since 1919</div>
            <div className="cod-ppo-addr">329 S Florida Grove Rd · Perth Amboy, NJ 08861<br />732-442-1286 · shevcoteam@gmail.com</div>
          </div>
          <div className="cod-ppo-poblock">
            <div className="cod-ppo-potitle">Purchase Order</div>
            <div className="cod-ppo-ponum sb-mono">{order.order_number || 'DRAFT'}</div>
            <div className="cod-ppo-podate">{fmtDate(order.submitted_at || order.created_at)}</div>
          </div>
        </div>
        <div className="cod-ppo-billto"><strong>{order.cemetery_name}</strong>{order.cemetery_contact_name ? ` · ${order.cemetery_contact_name}` : ''}{order.cemetery_contact_phone ? ` · ${order.cemetery_contact_phone}` : ''}</div>
        <table className="cod-ppo-table">
          <thead><tr><th>Door</th><th>Items / inscription</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {doors.map((d, i) => {
              const map = itemMapFor(d)
              return (
                <tr key={i}>
                  <td>{i + 1}{isSplit && d.location ? ` (${d.location})` : ''}</td>
                  <td>{(d.selectedItems || []).map(s => map[keyOf(s)]?.label || keyOf(s)).join(', ')}{d.inscriptionText ? <div className="cod-ppo-inscr">“{d.inscriptionText}”</div> : null}</td>
                  <td className="r sb-mono">{fmtUSD(getDoorPrice(d, pricing))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot><tr><td colSpan={2} className="r"><strong>Total</strong></td><td className="r sb-mono"><strong>{total ? fmtUSD(total) : '—'}</strong></td></tr></tfoot>
        </table>
      </div>
    </div>
  )
}

const styles = `
  .cod-back{ background:none; border:none; color:var(--sb-text-muted); font:inherit; font-size:13px; cursor:pointer; padding:0; margin-bottom:14px; }
  .cod-back:hover{ color:var(--sb-text); }
  .cod-head{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
  .cod-sub{ font-size:15px; color:var(--sb-text-muted); margin-top:4px; }
  .cod-head-right{ text-align:right; }
  .cod-pills{ display:flex; gap:6px; justify-content:flex-end; }
  .cod-pill{ font-size:11px; font-weight:500; border-radius:999px; padding:3px 10px; white-space:nowrap; }
  .cod-pill-status{ background:transparent; border:.5px solid var(--pill-color); color:var(--pill-color); }
  .cod-pill-pay{ background:var(--pill-color); color:#fff; }
  .cod-total{ font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; margin-top:8px; }
  .cod-paidline{ font-size:12px; color:var(--sb-text-muted); margin-top:2px; }
  .cod-meta{ font-size:12.5px; color:var(--sb-text-muted); margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
  .cod-actions{ display:flex; align-items:center; gap:10px; margin:16px 0 8px; flex-wrap:wrap; }
  .cod-btn{ border:.5px solid var(--sb-border); background:var(--sb-surface); color:var(--sb-text); border-radius:6px; padding:8px 14px; font:inherit; font-size:13px; cursor:pointer; }
  .cod-btn:hover{ background:var(--sb-surface-muted); }
  .cod-btn:disabled{ opacity:.5; cursor:not-allowed; }
  .cod-btn-primary{ background:var(--sb-text); color:var(--sb-bg); border-color:transparent; }
  .cod-btn-primary:hover{ opacity:.88; background:var(--sb-text); }
  .cod-input{ border:.5px solid var(--sb-border); background:var(--sb-surface); color:var(--sb-text); border-radius:6px; padding:7px 10px; font:inherit; font-size:13px; width:100%; box-sizing:border-box; }
  .cod-linkbtn{ border:none; background:none; padding:0; font:inherit; font-size:12px; color:#9A7209; cursor:pointer; }
  .cod-linkbtn:hover{ text-decoration:underline; }
  .cod-h2{ font-size:16px; font-weight:600; margin:24px 0 10px; }
  .cod-door{ border:.5px solid var(--sb-border); border-radius:8px; padding:14px 16px; margin-bottom:10px; background:var(--sb-surface); }
  .cod-door-head{ display:flex; align-items:center; gap:10px; }
  .cod-loc{ font-size:10px; text-transform:uppercase; letter-spacing:.05em; background:var(--sb-accent,#b8842a); color:#fff; border-radius:3px; padding:1px 7px; }
  .cod-door-sub{ margin-left:auto; font-weight:600; font-variant-numeric:tabular-nums; }
  .cod-door-items{ margin-top:8px; }
  .cod-li{ display:flex; justify-content:space-between; font-size:13px; padding:3px 0; color:var(--sb-text-secondary); }
  .cod-inscr{ font-style:italic; font-size:12.5px; color:var(--sb-text-muted); margin-top:6px; }
  .cod-notes{ font-size:12px; color:var(--sb-text-muted); margin-top:4px; }
  .cod-pays{ display:flex; flex-direction:column; gap:1px; background:var(--sb-border); border:.5px solid var(--sb-border); border-radius:8px; overflow:hidden; }
  .cod-payrow{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:11px 16px; background:var(--sb-surface); font-size:13px; }
  .cod-pay-l{ display:flex; align-items:baseline; gap:10px; }
  .cod-pay-amt{ font-weight:600; font-variant-numeric:tabular-nums; }
  .cod-pay-method{ color:var(--sb-text-secondary); }
  .cod-pay-ref{ color:var(--sb-text-muted); font-size:12px; }
  .cod-pay-r{ color:var(--sb-text-muted); font-size:12px; text-align:right; }
  .cod-pay-note{ font-style:italic; }
  .cod-paytotal{ background:var(--sb-surface-muted); font-weight:500; }
  .cod-jobs{ display:flex; flex-direction:column; gap:8px; }
  .cod-job{ display:flex; justify-content:space-between; align-items:center; gap:16px; width:100%; text-align:left; background:var(--sb-surface); border:.5px solid var(--sb-border); border-radius:8px; padding:12px 16px; cursor:pointer; font:inherit; }
  .cod-job:hover{ background:var(--sb-surface-muted); }
  .cod-job-title{ font-weight:500; font-size:14px; }
  .cod-job-next{ font-size:12px; color:var(--sb-text-muted); margin-top:2px; }
  .cod-job-r{ text-align:right; min-width:160px; }
  .cod-prog{ height:6px; background:var(--sb-surface-muted); border-radius:999px; overflow:hidden; }
  .cod-prog-bar{ height:100%; background:var(--sb-accent,#b8842a); }
  .cod-job-meta{ font-size:11.5px; color:var(--sb-text-muted); margin-top:4px; font-variant-numeric:tabular-nums; }
  .cod-modal-bg{ position:fixed; inset:0; background:rgba(15,20,25,.42); z-index:1000; display:flex; align-items:center; justify-content:center; padding:24px; }
  .cod-modal{ background:var(--sb-surface); border-radius:10px; max-width:420px; width:100%; padding:24px 26px; box-shadow:0 16px 48px rgba(15,20,25,.24); max-height:90vh; overflow-y:auto; }
  .cod-modal-title{ font-size:18px; font-weight:600; margin:0 0 8px; }
  .cod-modal-body{ font-size:13.5px; color:var(--sb-text-muted); margin:0 0 16px; }
  .cod-modal-field{ display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--sb-text-muted); margin-bottom:12px; }
  .cod-modal-field input, .cod-modal-field select, .cod-modal-field textarea{ font:inherit; font-size:13px; padding:8px 10px; border:.5px solid var(--sb-border); border-radius:6px; background:var(--sb-bg); color:var(--sb-text); }
  .cod-consequence{ font-size:12.5px; color:var(--sb-text-secondary); background:var(--sb-surface-muted); border-radius:6px; padding:8px 12px; margin-bottom:14px; }
  .cod-consequence.warn{ background:#fbe9d6; color:#9a5b1a; }
  .cod-modal-actions{ display:flex; justify-content:flex-end; gap:8px; }
  .cod-print{ display:none; }
  @media print{
    .sb-page > *:not(.cod-print){ display:none !important; }
    .cod{ padding:0; }
    .cod-print{ display:block; color:#111; font-size:12.5px; }
    .cod-ppo-lh{ display:flex; justify-content:space-between; border-bottom:2px solid #a8761f; padding-bottom:16px; }
    .cod-ppo-name{ font-size:21px; font-weight:700; letter-spacing:.03em; }
    .cod-ppo-estd{ font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#a8761f; margin-top:3px; font-weight:600; }
    .cod-ppo-addr{ font-size:11px; color:#555; margin-top:8px; line-height:1.5; }
    .cod-ppo-poblock{ text-align:right; }
    .cod-ppo-potitle{ font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:#888; font-weight:600; }
    .cod-ppo-ponum{ font-size:22px; font-weight:700; }
    .cod-ppo-podate{ font-size:11px; color:#555; margin-top:6px; }
    .cod-ppo-billto{ margin:18px 0 14px; font-size:13px; }
    .cod-ppo-table{ width:100%; border-collapse:collapse; }
    .cod-ppo-table th{ text-align:left; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#888; border-bottom:1.5px solid #111; padding:0 6px 7px; }
    .cod-ppo-table td{ padding:9px 6px; border-bottom:.5px solid #ddd; vertical-align:top; }
    .cod-ppo-table .r{ text-align:right; }
    .cod-ppo-inscr{ font-style:italic; color:#555; margin-top:3px; }
  }
`
if (typeof document !== 'undefined' && !document.getElementById('cod-styles')) {
  const tag = document.createElement('style'); tag.id = 'cod-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
