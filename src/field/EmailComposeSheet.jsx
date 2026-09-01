// =============================================================================
// EmailComposeSheet — send a real shop email from the phone (2026-09-01)
// =============================================================================
// Paul: "have option to send email to customer from the search profile page
// and include attachments in that email." Replaces the mailto: handoff — this
// goes out through shevcoteam@ via sendShopEmail like every desktop send, and
// NOTHING sends without the ConfirmSend gate (SEND-1 doctrine): exact To /
// subject / rendered body / attachment list, then the explicit gold button.
// Attachments come from the order's files (storage URL refs — big files skip
// the body cap) plus the pinned signed contract (fresh signed URL minted at
// send time so it can't expire mid-compose).
// =============================================================================
import { useState, useEffect, useMemo } from 'react'
import {
  sendShopEmail, listOrderAttachments, getSignedContract, signedContractFileUrl,
  logOrderActivity,
} from '../lib/stonebooksData'
import ConfirmSend from '../components/ConfirmSend'

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function EmailComposeSheet({ customer, order = null, orders = null, who, undo, onClose }) {
  const orderChoices = useMemo(() => {
    if (order) return [order]
    return (orders || []).filter(o => o && o.id)
  }, [order, orders])

  const [to, setTo] = useState(customer?.email || customer?.email_alt || '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachOrderId, setAttachOrderId] = useState(order?.id || (orderChoices.length === 1 ? orderChoices[0].id : ''))
  const [files, setFiles] = useState(undefined)     // undefined=loading, []=none
  const [signedPin, setSignedPin] = useState(null)
  const [checked, setChecked] = useState(() => new Set())
  const [withSigned, setWithSigned] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    setFiles(undefined); setSignedPin(null); setChecked(new Set()); setWithSigned(false)
    if (!attachOrderId) { setFiles([]); return }
    let cancelled = false
    ;(async () => {
      const [atts, pin] = await Promise.all([
        listOrderAttachments(attachOrderId).catch(() => []),
        getSignedContract(attachOrderId).catch(() => null),
      ])
      if (cancelled) return
      setFiles(atts || [])
      setSignedPin(pin)
    })()
    return () => { cancelled = true }
  }, [attachOrderId])

  const toggleFile = (path) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })

  const pickedFiles = (files || []).filter(f => checked.has(f.path))
  const attachNames = [
    ...(withSigned && signedPin ? ['Signed contract.pdf'] : []),
    ...pickedFiles.map(f => f.name),
  ]

  const composedHtml = useMemo(() =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1c1c;line-height:1.55">${esc(body).replace(/\n/g, '<br>')}</div>`,
  [body])

  const canPreview = to.trim() && subject.trim() && body.trim() && !busy

  const doSend = async (edited) => {
    setBusy(true)
    const attachments = pickedFiles.map(f => ({ filename: f.name, url: f.url }))
    if (withSigned && signedPin && attachOrderId) {
      // Fresh signed URL at send time — the server fetches it immediately.
      const s = await signedContractFileUrl(attachOrderId, 900)
      if (!s.ok) { setBusy(false); undo?.showError('Could not attach the signed contract.'); return }
      attachments.unshift({ filename: 'Signed contract.pdf', url: s.url, contentType: 'application/pdf' })
    }
    const res = await sendShopEmail({
      to: to.trim(),
      subject: subject.trim(),
      html: edited?.html || composedHtml,
      text: edited?.text || body,
      attachments,
      orderId: attachOrderId || null,
      customerId: customer?.id || null,
    })
    setBusy(false)
    if (!res.ok) { undo?.showError(res.error || 'Send failed.'); return }
    if (attachOrderId) {
      logOrderActivity(attachOrderId, {
        type: 'email',
        note: `Email sent to ${to.trim()} from the phone${who?.name ? ` (by ${who.name})` : ''}${attachNames.length ? ` — attached: ${attachNames.join(', ')}` : ''}`,
      }).catch(() => {})
    }
    setGateOpen(false)
    setSent(true)
    setTimeout(onClose, 1400)
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={busy ? undefined : onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">Email {customer ? `— ${[customer.first_name, customer.last_name].filter(Boolean).join(' ')}` : ''}</div>

        {sent ? (
          <div className="fl-empty" style={{ color: '#14775A', fontWeight: 700 }}>Email sent.</div>
        ) : (
          <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
            <div className="fl-lab">To</div>
            <input className="fl-input" type="email" placeholder="customer@email.com"
              value={to} onChange={e => setTo(e.target.value)} />
            <div className="fl-lab">Subject</div>
            <input className="fl-input" placeholder="Subject"
              value={subject} onChange={e => setSubject(e.target.value)} />
            <div className="fl-lab">Message</div>
            <textarea className="fl-textarea" style={{ minHeight: 110 }} placeholder="Type the email…"
              value={body} onChange={e => setBody(e.target.value)} />

            {orderChoices.length > 1 && (
              <>
                <div className="fl-lab">Attach files from</div>
                <select className="fl-input" value={attachOrderId}
                  onChange={e => setAttachOrderId(e.target.value)}>
                  <option value="">No order files</option>
                  {orderChoices.map(o => (
                    <option key={o.id} value={o.id}>{o.order_number || 'DRAFT'}{o.primary_lastname ? ` — ${o.primary_lastname}` : ''}</option>
                  ))}
                </select>
              </>
            )}

            {attachOrderId && (
              <div style={{ margin: '4px 0 8px' }}>
                <div className="fl-lab">Attachments</div>
                {files === undefined && <div style={{ fontSize: 12, color: '#8A8267' }}>Loading files…</div>}
                {files !== undefined && !signedPin && files.length === 0 && (
                  <div style={{ fontSize: 12, color: '#8A8267' }}>No files on this order.</div>
                )}
                {signedPin && (
                  <label className="fl-rowline" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={withSigned} onChange={() => setWithSigned(v => !v)}
                      style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#14775A' }}>SIGNED CONTRACT</span>
                  </label>
                )}
                {(files || []).map(f => (
                  <label key={f.path} className="fl-rowline" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked.has(f.path)} onChange={() => toggleFile(f.path)}
                      style={{ width: 20, height: 20, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#3A3628', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  </label>
                ))}
              </div>
            )}

            <button type="button" className="fl-btn fl-btn-gold" disabled={!canPreview}
              onClick={() => setGateOpen(true)}>
              Preview &amp; send
            </button>
            <button type="button" className="fl-btn fl-btn-ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <ConfirmSend open={gateOpen} to={to.trim()} subject={subject.trim()}
        html={composedHtml} text={body} attachments={attachNames}
        busy={busy} onConfirm={doSend} onClose={() => setGateOpen(false)} />
    </>
  )
}
