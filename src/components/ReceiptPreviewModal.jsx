// =============================================================================
// ReceiptPreviewModal — one reusable "view this receipt" modal.
// =============================================================================
// Given a receipt-shaped order + a specific payment, renders the ACTUAL receipt
// PDF in an <iframe> (via the shared generateReceiptPDF) and mounts the shared
// ReceiptActions (Print / Email / Download) beneath it. Used identically on the
// Payments tab, OrderDetail history, and CemeteryOrderDetail history — no parallel
// receipt system. Family orders omit grandTotalOverride; cemetery passes total_amount.
//
// Voided payments: generateReceiptPDF refuses to render one (defensive throw), so
// the modal catches that and shows a clear "voided — no receipt" panel instead of
// faking a document. Email uses the real sendShopEmail attachment path inside
// ReceiptActions (surfaces the true error if Gmail isn't configured).
// =============================================================================

import { useState, useEffect } from 'react'
import { generateReceiptPDF, ReceiptActions } from '../SalesMode'

export default function ReceiptPreviewModal({ order, payment, grandTotalOverride, onClose }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(null)
  const voided = !!payment?.voided

  useEffect(() => {
    if (voided) return
    let alive = true
    let made = null
    generateReceiptPDF(order, payment, { returnDoc: true, grandTotalOverride })
      .then(({ doc }) => {
        if (!alive) return
        made = URL.createObjectURL(doc.output('blob'))
        setUrl(made)
      })
      .catch(e => { if (alive) setErr(e?.message || 'Could not build the receipt.') })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [order, payment, grandTotalOverride, voided])

  return (
    <div className="rpm-overlay" onClick={onClose}>
      <style>{RPM_CSS}</style>
      <div className="rpm-modal" onClick={e => e.stopPropagation()}>
        <div className="rpm-head">
          <div className="rpm-title">Receipt{voided ? ' · VOIDED' : ''}</div>
          <button type="button" className="rpm-close" onClick={onClose}>Close ×</button>
        </div>

        {voided ? (
          <div className="rpm-voided">
            This payment was voided{payment?.voidedBy ? ` by ${payment.voidedBy}` : ''} — no receipt is issued for voided payments.
            {payment?.voidedReason ? <div className="rpm-voided-reason">Reason: {payment.voidedReason}</div> : null}
          </div>
        ) : err ? (
          <div className="rpm-err">⚠ {err}</div>
        ) : url ? (
          <iframe src={url} className="rpm-frame" title="Receipt preview" />
        ) : (
          <div className="rpm-loading">Building receipt…</div>
        )}

        {!voided && (
          <div className="rpm-actions">
            <ReceiptActions order={order} payment={payment} grandTotalOverride={grandTotalOverride} hidePreview />
          </div>
        )}
      </div>
    </div>
  )
}

const RPM_CSS = `
.rpm-overlay { position: fixed; inset: 0; z-index: 1300; background: rgba(15,20,25,0.5); display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px; overflow: auto; }
.rpm-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 720px; box-shadow: 0 24px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; max-height: calc(100vh - 80px); }
.rpm-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #f0ece1; }
.rpm-title { font-size: 16px; font-weight: 700; color: #0f1419; }
.rpm-close { border: none; background: none; font: inherit; font-size: 14px; font-weight: 600; color: #8a8472; cursor: pointer; }
.rpm-close:hover { color: #5d5d5a; }
.rpm-frame { width: 100%; height: 70vh; border: none; background: #525659; }
.rpm-loading, .rpm-err, .rpm-voided { padding: 40px 24px; text-align: center; color: #8a8472; font-size: 14px; }
.rpm-err { color: #b3261e; }
.rpm-voided { color: #b3261e; font-weight: 600; }
.rpm-voided-reason { margin-top: 8px; font-weight: 400; color: #8a8472; }
.rpm-actions { padding: 4px 18px 16px; }
`
