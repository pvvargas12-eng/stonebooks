// =============================================================================
// PermitSignModal — email a permit for remote e-signature (PB-ESIGN)
// =============================================================================
// Opens from the Permit Builder doc editor once an e-signature box is placed.
// Builds the CURRENT permit PDF, creates (or re-uses) a kind:'permit' signing
// link on the R2 rails — /sign/<token>: the customer reviews the permit, types
// their name, generates the cursive, submits; signing-submit stamps it into the
// esign box's exact rect, appends the ESIGN/UETA certificate, and drops the
// signed copy into the order's attachments. NO order-status side effects.
//
// Other order files ride along as attachments (storage URL refs — the email
// API fetches them server-side, big files never hit the body cap). NOTHING
// sends without the ConfirmSend gate (send-safety doctrine, TI-2026-001).
// =============================================================================
import { useState, useEffect } from 'react'
import {
  createSigningLink, getSignatureRequestsForOrder, listOrderAttachments,
  sendShopEmail, logOrderActivity, getCurrentStaffName, uploadOrderAttachment,
} from '../../lib/stonebooksData'
import { exportPermitPdf, permitEsignRects } from '../../lib/permitBuilder'
import ConfirmSend from '../ConfirmSend'

const SIGN_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
const emailish = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

// Chunked, so a multi-MB PDF doesn't blow the call stack (R2 pattern).
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function PermitSignModal({ doc, order, template, docData, onSaveFirst, onClose, say }) {
  const orderId = order?.id
  const surname = order?.primary_lastname
    || [order?.customer?.first_name, order?.customer?.last_name].filter(Boolean).join(' ') || ''
  const orderNo = order?.order_number || ''
  const permitTitle = doc?.title || template?.title || 'Permit'

  const [to, setTo] = useState(order?.customer?.email || '')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const [activeLink, setActiveLink] = useState(null)   // live kind:'permit' request
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [gate, setGate] = useState(null)               // { subject, html, text, attachments, signUrl }

  const loadFiles = async () => setFiles(await listOrderAttachments(orderId).catch(() => []))
  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    ;(async () => {
      const [atts, reqs] = await Promise.all([
        listOrderAttachments(orderId).catch(() => []),
        getSignatureRequestsForOrder(orderId).catch(() => []),
      ])
      if (cancelled) return
      setFiles(atts || [])
      // Resend-not-duplicate doctrine: a live PERMIT link gets re-sent, the
      // first link keeps working. Contract links are a different door.
      setActiveLink((reqs || []).find(r => (r.kind || 'contract') === 'permit'
        && (r.displayStatus === 'pending' || r.displayStatus === 'viewed')) || null)
    })()
    return () => { cancelled = true }
  }, [orderId])

  const toggleFile = (f) => setPicked(prev => {
    const n = new Set(prev)
    if (n.has(f.path)) n.delete(f.path); else n.add(f.path)
    return n
  })
  const onFilesChosen = async (e) => {
    const list = Array.from(e.target.files || [])
    e.target.value = ''
    if (!list.length) return
    setUploading(true); setErr(null)
    for (const file of list) {
      const r = await uploadOrderAttachment(orderId, file)
      if (!r.ok) { setErr(`Upload failed — ${r.error}`); setUploading(false); return }
      setPicked(prev => new Set([...prev, r.path]))
    }
    await loadFiles()
    setUploading(false)
  }

  const toList = to.split(',').map(s => s.trim()).filter(Boolean)
  const toValid = toList.length > 0 && toList.every(emailish)
  const pickedFiles = files.filter(f => picked.has(f.path))

  // Assemble everything, then open the gate — the preview IS the send surface.
  const openGate = async () => {
    setBusy(true); setErr(null)
    try {
      // The emailed snapshot must be exactly what's on screen.
      await onSaveFirst?.()

      let signUrl, expiresText = ''
      if (activeLink) {
        signUrl = `${SIGN_ORIGIN}/sign/${activeLink.token}`
        if (activeLink.expires_at) { try { expiresText = new Date(activeLink.expires_at).toLocaleDateString() } catch { /* ignore */ } }
      } else {
        const rects = permitEsignRects(template, docData)
        if (!rects) { setErr('Place the e-signature box on a form page first (+ E-signature).'); setBusy(false); return }
        const d = await exportPermitPdf({ template, docData, returnDoc: true })
        const pdfBase64 = bufToBase64(await d.output('blob').arrayBuffer())
        const res = await createSigningLink({
          orderId, pdfBase64, sigFieldRects: rects, customerEmail: toList[0] || null, kind: 'permit',
        })
        if (!res.ok) { setErr(res.error || 'Could not create the signing link.'); setBusy(false); return }
        signUrl = res.url
        if (res.expiresAt) { try { expiresText = new Date(res.expiresAt).toLocaleDateString() } catch { /* ignore */ } }
      }

      // Hand-picked order files ride as storage URL refs.
      const attachments = pickedFiles.map(f => ({ filename: f.name, url: f.url }))

      const subject = `Permit signature needed — ${surname}${orderNo ? ` (${orderNo})` : ''}`
      const cem = order?.cemetery?.name || ''
      const lines = [
        `Dear ${surname || 'valued customer'},`,
        '',
        `The cemetery permit for your memorial${cem ? ` at ${cem}` : ''} is ready for your signature.`,
        ...(note.trim() ? ['', note.trim()] : []),
        '',
        'Please click the link below to review the permit and sign it electronically — it takes about a minute:',
        signUrl,
        ...(expiresText ? ['', `This link is valid through ${expiresText}.`] : []),
        ...(attachments.length ? ['', `Also attached: ${attachments.map(a => a.filename).join(', ')}.`] : []),
        '',
        'Thank you,',
        'Shevchenko Monuments',
        '732-442-1286',
      ]
      const text = lines.join('\n')
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2430;line-height:1.55">`
        + lines.map(l => l === signUrl
          ? `<p style="margin:18px 0"><a href="${esc(signUrl)}" style="background:#0F1419;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Review &amp; sign the permit</a></p>`
          : `<p style="margin:6px 0">${esc(l) || '&nbsp;'}</p>`).join('')
        + `</div>`

      setGate({ subject, html, text, attachments, signUrl })
    } catch (e) {
      setErr(e?.message || 'Could not prepare the email.')
    }
    setBusy(false)
  }

  const doSend = async (edited) => {
    if (!gate) return
    setBusy(true); setErr(null)
    const html = edited?.html || gate.html
    const text = edited?.text || gate.text
    const r = await sendShopEmail({
      to: toList.join(', '), subject: gate.subject, html, text,
      attachments: gate.attachments,
      orderId, customerId: order?.customer_id || order?.customer?.id || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error || 'The email could not be sent.'); setGate(null); return }
    const actor = await getCurrentStaffName().catch(() => null)
    logOrderActivity(orderId, {
      type: 'change', field: 'Permit', newValue: 'Sign link emailed',
      note: `Permit e-sign link emailed to ${toList.join(', ')} (${permitTitle})`, actor,
    }).catch(() => {})
    say?.('Permit sign email sent.')
    onClose?.()
  }

  return (
    <div className="psm-overlay" onClick={() => { if (!busy) onClose?.() }}>
      <div className="psm" onClick={e => e.stopPropagation()}>
        <div className="psm-title">Email the permit to sign</div>
        <div className="psm-sub">
          {surname}{orderNo ? ` · ${orderNo}` : ''} — {permitTitle}. The customer opens a private link,
          reviews this exact permit, and signs in the box you placed. The signed copy lands back in the
          order&rsquo;s attachments automatically.
        </div>

        {activeLink && (
          <div className="psm-active">
            A signing link is already out{activeLink.customer_email ? ` (sent for ${activeLink.customer_email})` : ''} —
            this email re-sends the SAME link, so the first one keeps working.
          </div>
        )}

        <label className="psm-label">To</label>
        <input className="psm-input" type="text" value={to} onChange={e => setTo(e.target.value)}
          placeholder="customer@email.com — commas for several" />

        <label className="psm-label">Note to the customer (optional)</label>
        <textarea className="psm-input psm-area" value={note} onChange={e => setNote(e.target.value)}
          placeholder="Anything you want to say above the signing link…" />

        <label className="psm-label">Attach order files (optional)</label>
        <div className="psm-files">
          {files.length === 0 && <span className="psm-none">No files on this order yet.</span>}
          {files.map(f => (
            <label key={f.path} className="psm-file">
              <input type="checkbox" checked={picked.has(f.path)} onChange={() => toggleFile(f)} />
              <span className="psm-fname">{f.name}</span>
              <a href={f.url} target="_blank" rel="noreferrer" className="psm-view">view</a>
            </label>
          ))}
          <label className="psm-upload">
            {uploading ? 'Uploading…' : '+ Upload a file'}
            <input type="file" multiple style={{ display: 'none' }} onChange={onFilesChosen} disabled={uploading} />
          </label>
        </div>

        {err && <div className="psm-err">⚠ {err}</div>}

        <div className="psm-actions">
          <button type="button" className="psm-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="psm-btn psm-btn-go" onClick={openGate} disabled={busy || !toValid}>
            {busy ? 'Working…' : 'Preview + send'}
          </button>
        </div>
      </div>

      <ConfirmSend open={!!gate} to={toList.join(', ')} subject={gate?.subject || ''} html={gate?.html || ''}
        busy={busy} onConfirm={doSend} onClose={() => setGate(null)} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
  .psm-overlay { position: fixed; inset: 0; background: rgba(15,20,25,0.45); z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .psm { background: #fff; border-radius: 12px; box-shadow: 0 18px 50px rgba(15,20,25,0.28);
    width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; padding: 24px 28px; }
  .psm-title { font-size: 18px; font-weight: 600; color: #0F1419; margin-bottom: 6px; }
  .psm-sub { font-size: 13px; color: #5a6672; line-height: 1.5; margin-bottom: 14px; }
  .psm-active { font-size: 12.5px; color: #7a5b12; background: #faf3e0; border: 1px solid #e6d9b8;
    border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
  .psm-label { display: block; font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: #6b7682; margin: 12px 0 4px; }
  .psm-input { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px;
    padding: 9px 11px; border: 1px solid #cfd6de; border-radius: 8px; }
  .psm-area { min-height: 68px; resize: vertical; }
  .psm-files { border: 1px solid #e3e8ee; border-radius: 8px; padding: 8px 12px; max-height: 180px; overflow-y: auto; }
  .psm-file { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13.5px; cursor: pointer; }
  .psm-fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .psm-view { color: #9a6a3a; font-size: 12px; text-decoration: none; }
  .psm-none { font-size: 13px; color: #8a929b; }
  .psm-upload { display: inline-block; font-size: 13px; font-weight: 600; color: #9a6a3a; cursor: pointer; padding: 6px 0 2px; }
  .psm-err { color: #b3261e; font-size: 13.5px; margin-top: 12px; }
  .psm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  .psm-btn { font: inherit; font-size: 14px; font-weight: 500; padding: 9px 18px; border-radius: 8px;
    border: 1px solid #cfd6de; background: #fff; color: #1c2430; cursor: pointer; }
  .psm-btn-go { background: #0F1419; border-color: #0F1419; color: #fff; font-weight: 600; }
  .psm-btn:disabled { opacity: 0.55; cursor: not-allowed; }
`
