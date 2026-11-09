// =============================================================================
// CemeteryInvoiceModal — preview the one-page invoice, then email / download /
// print it, or jump to the order's pricing page (CEM-INVOICE 2026-11-09).
// =============================================================================
// The PDF is built from the LIVE order (doors, price list, custom charges, tax
// and card-fee toggles) and the recorded payments, so Paid to date and Balance
// due are real. Email goes through ConfirmSend — the send-safety gate — with
// the exact recipient, subject, body and attachment name shown first. No
// one-click send. A successful send stamps invoiced_at / invoiced_to.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { getCemeteryOrder, getFinancialRecords, sendShopEmail, markCemeteryOrderInvoiced, fmtUSD } from '../lib/stonebooksData'
import { buildCemeteryInvoicePdf, buildCemeteryInvoiceEmail } from '../lib/cemeteryInvoice'
import ConfirmSend from './ConfirmSend'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const splitTo = (s) => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean)

export default function CemeteryInvoiceModal({ orderId, onClose, onAdjustPricing }) {
  const [order, setOrder] = useState(null)
  const [built, setBuilt] = useState(null)      // { doc, filename, totals, balance, paid }
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)        // 'build' | 'send' | 'print' | 'download'
  const [to, setTo] = useState('')
  const [gate, setGate] = useState(false)
  const [sent, setSent] = useState(null)
  const urlRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setBusy('build'); setErr(null)
    ;(async () => {
      try {
        const [o, pays] = await Promise.all([
          getCemeteryOrder(orderId),
          getFinancialRecords({ recordType: 'payment_received', cemeteryOrderId: orderId }),
        ])
        if (cancelled) return
        if (!o) { setErr('Order not found.'); setBusy(null); return }
        const paid = (pays || []).filter(p => !p.voided).reduce((s, p) => s + (Number(p.amount) || 0), 0)
        const b = await buildCemeteryInvoicePdf(o, { paidTotal: paid })
        if (cancelled) return
        const blobUrl = URL.createObjectURL(b.doc.output('blob'))
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = blobUrl
        setOrder(o); setBuilt(b); setUrl(blobUrl); setTo(o.cemetery_contact_email || '')
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not build the invoice.')
      } finally {
        if (!cancelled) setBusy(null)
      }
    })()
    return () => { cancelled = true }
  }, [orderId])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !gate) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gate, onClose])

  const recipients = splitTo(to)
  const toValid = recipients.length > 0 && recipients.every(r => EMAIL_RE.test(r))
  const email = (order && built) ? buildCemeteryInvoiceEmail(order, built.totals, { balance: built.balance, paid: built.paid }) : null

  const download = () => { if (built) built.doc.save(built.filename) }
  const print = () => {
    if (!url) return
    const w = window.open(url, '_blank')
    if (w) setTimeout(() => { try { w.print() } catch { /* viewer prints from its own toolbar */ } }, 600)
  }
  const send = async (edited) => {
    if (!built || !email || !toValid) return
    setBusy('send'); setErr(null)
    try {
      const contentBase64 = (built.doc.output('datauristring').split('base64,')[1]) || ''
      const res = await sendShopEmail({
        to: recipients.join(', '),
        subject: email.subject,
        html: edited?.html || email.html,
        text: edited?.text || email.text,
        attachments: [{ filename: built.filename, contentBase64, contentType: 'application/pdf' }],
      })
      if (!res?.ok) { setErr(res?.error || 'The email did not send.'); return }
      await markCemeteryOrderInvoiced(order.id, { sentTo: recipients.join(', ') })
      setSent(recipients.join(', ')); setGate(false)
    } catch (e) {
      setErr(e?.message || 'The email did not send.')
    } finally {
      setBusy(null)
    }
  }

  const num = order?.order_number || 'DRAFT'
  return (
    <div className="ci-scrim" onClick={() => !gate && onClose?.()}>
      <div className="ci-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${num}`} onClick={e => e.stopPropagation()}>
        <div className="ci-head">
          <div className="ci-head-main">
            <div className="ci-eyebrow">Invoice</div>
            <div className="ci-title"><span className="sb-mono">{num}</span>{order ? <span className="ci-cem">{order.cemetery_name}</span> : null}</div>
            {built && (
              <div className="ci-money">
                Total <b>{fmtUSD(built.totals.total)}</b>
                {built.paid > 0 && <> · Paid <b>{fmtUSD(built.paid)}</b></>}
                {' · '}Balance due <b className={built.balance > 0 ? 'ci-red' : 'ci-green'}>{fmtUSD(built.balance)}</b>
                {order?.invoiced_at && <span className="ci-stamp">Last sent {new Date(order.invoiced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{order.invoiced_to ? ` to ${order.invoiced_to}` : ''}</span>}
              </div>
            )}
          </div>
          <button type="button" className="ci-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ci-bar">
          <label className="ci-to">
            <span>Email to</span>
            <input id="ci-to-input" type="text" value={to} onChange={e => setTo(e.target.value)} placeholder="cemetery email on file" />
          </label>
          <button type="button" className="ci-btn ci-btn-gold" disabled={!built || !toValid || busy} onClick={() => setGate(true)} title={toValid ? 'Preview the email, then send' : 'Type a valid email address first'}>Email to cemetery</button>
          <button type="button" className="ci-btn" disabled={!built || busy} onClick={download}>Download PDF</button>
          <button type="button" className="ci-btn" disabled={!url || busy} onClick={print}>Print</button>
          <span className="ci-spacer" />
          {onAdjustPricing && <button type="button" className="ci-btn ci-btn-dark" disabled={!order} onClick={() => onAdjustPricing(order)}>Adjust pricing &amp; line items</button>}
        </div>

        {err && <div className="ci-msg ci-msg-err">{err}</div>}
        {sent && <div className="ci-msg ci-msg-ok">Sent to {sent}. The order is stamped as invoiced.</div>}
        {!toValid && order && !err && <div className="ci-msg">No valid cemetery email on file. Type one above to send, or download and send it yourself.</div>}

        <div className="ci-body">
          {busy === 'build' && <div className="ci-wait">Building the invoice…</div>}
          {url && <iframe title={`Invoice ${num}`} className="ci-frame" src={`${url}#toolbar=0&navpanes=0`} />}
        </div>
      </div>

      {gate && email && (
        <ConfirmSend
          open
          to={recipients.join(', ')}
          subject={email.subject}
          html={email.html}
          text={email.text}
          attachments={[built.filename]}
          busy={busy === 'send'}
          confirmLabel="Send invoice"
          onConfirm={send}
          onClose={() => !busy && setGate(false)}
        />
      )}
    </div>
  )
}

const styles = `
  .ci-scrim{ position:fixed; inset:0; background:rgba(15,20,25,.5); z-index:1050; display:flex; align-items:center; justify-content:center; padding:18px; }
  .ci-modal{ background:var(--sb-surface,#fff); color:var(--sb-text,#111); border-radius:12px; width:min(980px,100%); height:min(94vh,1100px); display:flex; flex-direction:column; box-shadow:0 24px 64px rgba(15,20,25,.3); overflow:hidden; min-width:0; }
  .ci-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 20px 10px; border-bottom:.5px solid var(--sb-border,#e4e0d8); }
  .ci-head-main{ min-width:0; }
  .ci-eyebrow{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--sb-text-muted,#73777e); }
  .ci-title{ font-size:20px; font-weight:600; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; min-width:0; }
  .ci-cem{ font-size:15px; font-weight:400; color:var(--sb-text-muted,#73777e); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
  .ci-money{ font-size:12.5px; color:var(--sb-text-muted,#73777e); margin-top:4px; display:flex; gap:4px; flex-wrap:wrap; align-items:baseline; }
  .ci-money b{ color:var(--sb-text,#111); font-variant-numeric:tabular-nums; }
  .ci-red{ color:#b54040 !important; } .ci-green{ color:#2d7a4f !important; }
  .ci-stamp{ margin-left:8px; font-size:11.5px; color:#2d7a4f; }
  .ci-x{ border:none; background:none; font-size:24px; line-height:1; color:var(--sb-text-muted,#73777e); cursor:pointer; padding:2px 6px; }
  .ci-x:hover{ color:var(--sb-text,#111); }
  .ci-bar{ display:flex; gap:8px; align-items:center; padding:10px 20px; border-bottom:.5px solid var(--sb-border,#e4e0d8); flex-wrap:wrap; }
  .ci-to{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--sb-text-muted,#73777e); min-width:0; flex:1 1 260px; }
  .ci-to input{ flex:1; min-width:0; font:inherit; font-size:13px; padding:7px 10px; border:.5px solid var(--sb-border,#e4e0d8); border-radius:6px; background:var(--sb-surface,#fff); color:var(--sb-text,#111); }
  .ci-btn{ font:inherit; font-size:13px; padding:8px 14px; border-radius:7px; border:.5px solid var(--sb-border,#e4e0d8); background:var(--sb-surface,#fff); color:var(--sb-text,#111); cursor:pointer; white-space:nowrap; }
  .ci-btn:hover:not(:disabled){ background:var(--sb-surface-muted,#f4f2ee); }
  .ci-btn:disabled{ opacity:.5; cursor:not-allowed; }
  .ci-btn-gold{ background:#9A7209; border-color:#9A7209; color:#fff; font-weight:600; }
  .ci-btn-gold:hover:not(:disabled){ background:#7d5d07; }
  .ci-btn-dark{ background:var(--sb-text,#111); color:var(--sb-bg,#fff); border-color:transparent; }
  .ci-btn-dark:hover:not(:disabled){ opacity:.88; background:var(--sb-text,#111); }
  .ci-spacer{ flex:1; }
  .ci-msg{ font-size:12.5px; padding:8px 20px; color:var(--sb-text-muted,#73777e); background:var(--sb-surface-muted,#f4f2ee); border-bottom:.5px solid var(--sb-border,#e4e0d8); overflow-wrap:anywhere; }
  .ci-msg-err{ color:#b54040; background:#fbeaea; }
  .ci-msg-ok{ color:#2d7a4f; background:#e6f4ec; }
  .ci-body{ flex:1; min-height:0; background:#6b6b6b; position:relative; }
  .ci-frame{ width:100%; height:100%; border:none; display:block; }
  .ci-wait{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; }
  @media (max-width:640px){ .ci-scrim{ padding:0; } .ci-modal{ height:100vh; border-radius:0; } .ci-spacer{ display:none; } }
`
if (typeof document !== 'undefined' && !document.getElementById('ci-styles')) {
  const tag = document.createElement('style'); tag.id = 'ci-styles'; tag.textContent = styles
  document.head.appendChild(tag)
}
