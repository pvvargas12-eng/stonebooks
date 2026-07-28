// =============================================================================
// SalesEmailModal — the customer-facing sales bundle, in ONE email
// =============================================================================
// Paul 2026-07-28: "I want to send a customer an email to view the permit,
// view the layout estimate and view contract to e sign. the permit does not
// get e signed... one email... button that says generate SALES EMAIL."
// And, from a lead: "add an option to email unsigned contract to a customer
// for signature with the e signature box."
//
// One modal, two doors (mode prop):
//   'contract' — Email contract to sign: just the /sign/<token> e-sign link.
//   'sales'    — Sales email: contract sign link + estimate PDF + monument
//                layout image + built permit PDF (view only), each toggleable.
//
// The e-sign link rides the EXISTING R2 remote-signing rails (signing-create
// Edge Function → /sign/<token> page: customer reviews the PDF, prints their
// name, generates the signature, date autofills). If an active link already
// exists it is RE-SENT rather than duplicated — "did you get it?" resends
// don't void the first link. NOTHING sends without the ConfirmSend gate
// (send-safety doctrine, TI-2026-001).
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import {
  createSigningLink, getSignatureRequestsForOrder, listOrderAttachments,
  getProofVersionsByOrder, sendShopEmail, logOrderActivity, getCurrentStaffName,
  uploadOrderAttachment, saveEmailDraft, deleteEmailDraft,
} from '../lib/stonebooksData'
import { rowToOrder, generateContractPDF, generateEstimatePDF } from '../SalesMode'
import ConfirmSend from './ConfirmSend'

const SIGN_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''

// Chunked, so a multi-MB contract PDF doesn't blow the call stack (R2 pattern).
const bufToBase64 = (buf) => {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

const fetchAttachment = async (url, filename) => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const type = res.headers.get('content-type') || 'application/octet-stream'
    const buf = await res.arrayBuffer()
    return { filename, contentBase64: bufToBase64(buf), contentType: type.split(';')[0] }
  } catch { return null }
}

const emailish = (s) => /\S+@\S+\.\S+/.test(s)

// Module-scope (react-hooks/static-components): one include-this checkbox row.
function BundleItem({ checked, disabled, onToggle, label, hint, disabledHint }) {
  return (
    <label className={`sb-sem-item${disabled ? ' off' : ''}`}>
      <input type="checkbox" checked={!!checked && !disabled} disabled={disabled} onChange={onToggle} />
      <span>
        <span className="sb-sem-item-l">{label}</span>
        <span className="sb-sem-item-h">{disabled ? disabledHint : hint}</span>
      </span>
    </label>
  )
}

export default function SalesEmailModal({ order, mode = 'sales', draft = null, onClose, onSent, onSaved }) {
  const orderId = order?.id
  const surname = order?.primary_lastname || 'Order'
  const orderNo = order?.order_number || ''
  const isSigned = !!order?.signed_at
  const contractMode = mode === 'contract'
  const dp = draft?.payload || null   // resume a parked draft exactly where it stopped

  const [to, setTo] = useState(dp?.to ?? (order?.customer?.email || ''))
  const [note, setNote] = useState(dp?.note ?? '')
  const [items, setItems] = useState(dp?.items ?? { contract: !isSigned, estimate: !contractMode, layout: false, permit: false })
  const [permitRow, setPermitRow] = useState(null)     // built permit attachment
  const [layoutRow, setLayoutRow] = useState(null)     // proof version w/ layout image
  const [activeSign, setActiveSign] = useState(null)   // reusable pending/viewed link
  const [files, setFiles] = useState([])               // every order attachment (storage listing)
  const [picked, setPicked] = useState(() => new Set((dp?.files || []).map(f => f.path)))
  const [uploading, setUploading] = useState(false)
  const [draftId, setDraftId] = useState(draft?.id || null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)
  // Built for the gate: { subject, html, text, attachments }
  const [gate, setGate] = useState(null)

  const loadFiles = async () => {
    const atts = await listOrderAttachments(orderId).catch(() => [])
    setFiles(atts || [])
    return atts || []
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [atts, reqs, proofs] = await Promise.all([
        listOrderAttachments(orderId).catch(() => []),
        getSignatureRequestsForOrder(orderId).catch(() => []),
        getProofVersionsByOrder(orderId).catch(() => []),
      ])
      if (cancelled) return
      setFiles(atts || [])
      // The built permit PDF — attachPermitPdfToOrder writes it into this
      // order's storage folder as `permit-<docId>.pdf` (listOrderAttachments
      // returns the STORAGE listing: { name, url, path, createdAt }).
      const permits = (atts || []).filter(a =>
        /^permit-[^/]+\.pdf$/i.test(a.name || '') || /\/permit-[^/]+\.pdf$/i.test(a.path || ''))
      permits.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      const p = permits[0] || null
      // The customer's monument layout — current proof first (list is version-desc).
      const l = (proofs || []).find(v => v.is_current && v.layout_image_url)
        || (proofs || []).find(v => v.layout_image_url) || null
      const s = (reqs || []).find(r => r.displayStatus === 'pending' || r.displayStatus === 'viewed') || null
      setPermitRow(p); setLayoutRow(l); setActiveSign(s)
      // Fresh sales email defaults its bundle from what's on file; a resumed
      // draft keeps exactly what was checked when it was parked.
      if (!contractMode && !dp) setItems(prev => ({ ...prev, layout: !!l, permit: !!p }))
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, contractMode])

  const toggle = (k) => setItems(prev => ({ ...prev, [k]: !prev[k] }))
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
  const pickedFiles = files.filter(f => picked.has(f.path))
  const nothingPicked = !items.contract && !items.estimate && !items.layout && !items.permit && pickedFiles.length === 0
  const toList = to.split(',').map(s => s.trim()).filter(Boolean)
  const toValid = toList.length > 0 && toList.every(emailish)

  // Park it — the whole screen state persists; Edit in the order's Email
  // drafts strip brings it back exactly here.
  const handleSaveDraft = async () => {
    setSavingDraft(true); setErr(null)
    const me = await getCurrentStaffName().catch(() => null)
    const r = await saveEmailDraft({
      id: draftId, orderId, customerId: order.customer_id || order.customer?.id || null,
      kind: mode,
      payload: { to, note, items, files: pickedFiles.map(f => ({ name: f.name, url: f.url, path: f.path })) },
      by: me,
    })
    setSavingDraft(false)
    if (!r.ok) { setErr(r.error || 'Could not save the draft.'); return }
    setDraftId(r.id)
    onSaved?.('Draft saved — pick it back up from Email drafts on this order.')
    onClose?.()
  }

  // Assemble everything, then open the gate — the preview IS the send surface.
  const openGate = async () => {
    setBusy(true); setErr(null)
    try {
      const camel = rowToOrder(order, order.customer, order.cemetery)
      const attachments = []
      let signUrl = null
      let signExpiresText = ''

      if (items.contract) {
        if (activeSign) {
          signUrl = `${SIGN_ORIGIN}/sign/${activeSign.token}`
          if (activeSign.expires_at) { try { signExpiresText = new Date(activeSign.expires_at).toLocaleDateString() } catch { /* ignore */ } }
        } else {
          const { doc, signFields } = await generateContractPDF(camel, { returnDoc: true })
          const pdfBase64 = bufToBase64(await doc.output('blob').arrayBuffer())
          const res = await createSigningLink({
            orderId, pdfBase64, sigFieldRects: signFields, customerEmail: toList[0] || null,
          })
          if (!res.ok) { setErr(res.error || 'Could not create the signing link.'); setBusy(false); return }
          signUrl = res.url
          if (res.expiresAt) { try { signExpiresText = new Date(res.expiresAt).toLocaleDateString() } catch { /* ignore */ } }
        }
      }

      if (items.estimate) {
        const est = await generateEstimatePDF(camel, { returnDoc: true, mode: 'estimate' })
        const pdfBase64 = bufToBase64(await est.doc.output('blob').arrayBuffer())
        attachments.push({
          filename: est.filename || `Shevchenko-Estimate-${orderNo || 'draft'}-${surname}.pdf`,
          contentBase64: pdfBase64, contentType: 'application/pdf',
        })
      }

      if (items.layout && layoutRow) {
        const ext = /\.png(\?|$)/i.test(layoutRow.layout_image_url) ? 'png' : 'jpg'
        const a = await fetchAttachment(layoutRow.layout_image_url, `Monument layout - ${surname}.${ext}`)
        if (a) attachments.push(a)
        else { setErr('Could not load the layout image for attaching.'); setBusy(false); return }
      }

      if (items.permit && permitRow) {
        const a = await fetchAttachment(permitRow.url, `Permit - ${surname}.pdf`)
        if (a) attachments.push(a)
        else { setErr('Could not load the permit PDF for attaching.'); setBusy(false); return }
      }

      // Hand-picked / freshly uploaded order files ride along too.
      for (const f of pickedFiles) {
        const a = await fetchAttachment(f.url, f.name)
        if (a) attachments.push(a)
        else { setErr(`Could not load ${f.name} for attaching.`); setBusy(false); return }
      }

      // ── Compose ──
      const svc = order.service_types || []
      const depositLine = (svc.includes('NEW_STONE') || svc.includes('BRONZE'))
        ? 'A 50% deposit is due to place your order; the remaining balance is due before carving work begins.'
        : 'Payment in full is due before work begins.'
      const expires = signExpiresText ? ` on ${signExpiresText}` : ' in 14 days'
      const subject = contractMode
        ? `Your contract from Shevchenko Monuments${orderNo ? ` — ${orderNo}` : ''}`
        : `Your monument paperwork from Shevchenko Monuments${orderNo ? ` — ${orderNo}` : ''}`

      const bullets = []
      if (items.contract) bullets.push('<li style="margin:0 0 6px"><b>Contract</b> — review every term and sign online with the secure button below.</li>')
      if (items.estimate) bullets.push('<li style="margin:0 0 6px"><b>Estimate</b> — attached as a PDF.</li>')
      if (items.layout) bullets.push('<li style="margin:0 0 6px"><b>Monument layout</b> — attached as an image.</li>')
      if (items.permit) bullets.push('<li style="margin:0 0 6px"><b>Cemetery permit</b> — attached for your review. No signature is needed on the permit.</li>')
      for (const f of pickedFiles) {
        bullets.push(`<li style="margin:0 0 6px"><b>${String(f.name).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b> — attached.</li>`)
      }

      const noteHtml = note.trim()
        ? `<p style="margin:0 0 10px">${note.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` : ''
      const html =
        `<div style="font-family:Arial,sans-serif;font-size:15px;color:#17202a;line-height:1.6">` +
        `<p style="margin:0 0 10px">Hello,</p>` +
        noteHtml +
        (bullets.length > 1
          ? `<p style="margin:0 0 6px">Here is your monument paperwork from Shevchenko Monuments:</p><ul style="margin:0 0 10px;padding-left:20px">${bullets.join('')}</ul>`
          : `<p style="margin:0 0 10px">Please review and sign your monument contract using the secure link below. You can read every term, sign online, and download your signed copy right away.</p>`) +
        (items.contract
          ? `<p style="margin:0 0 10px"><b>${depositLine}</b></p>` +
            `<p style="margin:18px 0"><a href="${signUrl}" style="background:#1e2d3d;color:#ffffff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:700">Review &amp; sign your contract →</a></p>` +
            `<p style="margin:0 0 10px;color:#6b7682;font-size:12.5px">This link expires${expires}.</p>`
          : '') +
        `<p style="margin:0">Thank you,<br>Shevchenko Monuments · 732-442-1286</p></div>`

      const textParts = ['Hello,']
      if (note.trim()) textParts.push(note.trim())
      if (bullets.length > 1) {
        const plain = []
        if (items.contract) plain.push('- Contract: review and sign online at the link below.')
        if (items.estimate) plain.push('- Estimate: attached as a PDF.')
        if (items.layout) plain.push('- Monument layout: attached as an image.')
        if (items.permit) plain.push('- Cemetery permit: attached for your review (no signature needed).')
        for (const f of pickedFiles) plain.push(`- ${f.name}: attached.`)
        textParts.push('Here is your monument paperwork from Shevchenko Monuments:\n' + plain.join('\n'))
      } else if (items.contract) {
        textParts.push('Please review and sign your contract at the link below.')
      }
      if (items.contract) textParts.push(`${depositLine}\n\nReview & sign: ${signUrl}\n(This link expires${expires}.)`)
      textParts.push('Thank you,\nShevchenko Monuments · 732-442-1286')

      setGate({ subject, html, text: textParts.join('\n\n'), attachments, signUrl })
    } catch (e) {
      setErr(e?.message || 'Could not prepare the email.')
    } finally {
      setBusy(false)
    }
  }

  const doSend = async () => {
    if (!gate) return
    setBusy(true); setErr(null)
    const r = await sendShopEmail({
      to: toList.join(', '), subject: gate.subject, html: gate.html, text: gate.text,
      attachments: gate.attachments,
      orderId, customerId: order.customer_id || order.customer?.id || null,
    })
    if (!r?.ok) { setBusy(false); setErr(r?.error || 'Send failed.'); setGate(null); return }
    const me = await getCurrentStaffName().catch(() => null)
    const included = [
      items.contract && 'contract sign link',
      items.estimate && 'estimate', items.layout && 'layout', items.permit && 'permit',
      pickedFiles.length > 0 && `${pickedFiles.length} file${pickedFiles.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' + ')
    await logOrderActivity(orderId, {
      type: 'change', field: contractMode ? 'Contract for signature' : 'Sales email', newValue: 'Sent',
      note: `Sent to ${toList.join(', ')} — ${included}`, actor: me,
    }).catch(() => {})
    if (draftId) await deleteEmailDraft(draftId).catch(() => {})   // sent = no longer a draft
    setBusy(false); setGate(null)
    onSent?.(`Sent to ${toList.join(', ')} — ${included}.`)
    onClose?.()
  }

  return (
    <div className="sb-sem-scrim" onClick={onClose}>
      <div className="sb-sem" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sb-sem-title">{contractMode ? 'Email contract for signature' : 'Sales email'}</div>
        <div className="sb-sem-sub">
          {contractMode
            ? 'The customer opens a secure link, reviews the contract, prints their name, signs electronically — the date fills itself.'
            : 'One email with everything the family needs — the permit is view-only; the contract carries the e-sign link.'}
        </div>

        {loading && <div className="sb-sem-note">Checking what this order has on file…</div>}

        {!loading && (
          <>
            {!to.trim() && (
              <div className="sb-sem-warn">No email on the customer card — type one here or add it on the order first.</div>
            )}
            <label className="sb-sem-l">To <span className="sb-sem-l-soft">(commas for more than one)</span>
              <input className="sb-sem-in" value={to} onChange={e => setTo(e.target.value)} placeholder="customer@email.com" />
            </label>

            <div className="sb-sem-l" style={{ display: 'block' }}>What goes in
              <div className="sb-sem-items">
                {isSigned ? (
                  <div className="sb-sem-note">Contract already signed — no signature request in this email.</div>
                ) : (
                  <BundleItem checked={items.contract} onToggle={() => toggle('contract')}
                    label="Contract — e-sign link"
                    hint={activeSign
                      ? `An active signing link already exists (${activeSign.displayStatus}) — this re-sends that same link.`
                      : 'Creates a secure signing link. Print name + e-signature + auto date.'} />
                )}
                {/* The full bundle is offered in BOTH doors (Paul 2026-07-28:
                    "for this email contract to sign must be able to add
                    permit, design…") — only the DEFAULT checks differ. */}
                <BundleItem checked={items.estimate} onToggle={() => toggle('estimate')}
                  label="Estimate (PDF)" hint="Line items with per-item rates hidden — total shows." />
                <BundleItem checked={items.layout} onToggle={() => toggle('layout')} disabled={!layoutRow}
                  label="Monument layout (image)"
                  hint={`Layout v${layoutRow?.version_number ?? ''} attached as an image.`}
                  disabledHint="No layout on file yet — upload one in the Design hub first." />
                <BundleItem checked={items.permit} onToggle={() => toggle('permit')} disabled={!permitRow}
                  label="Cemetery permit (PDF, view only)"
                  hint="The built permit, attached. Not e-signed — view only."
                  disabledHint="No built permit on this order — build it in Permit Builder first." />
              </div>
            </div>

            <div className="sb-sem-l" style={{ display: 'block' }}>Order files
              <span className="sb-sem-l-soft"> — check to attach, click a name to view</span>
              <div className="sb-sem-files">
                {files.length === 0 && <div className="sb-sem-note">No files on this order yet.</div>}
                {files.map(f => (
                  <div key={f.path} className="sb-sem-file">
                    <input type="checkbox" checked={picked.has(f.path)} onChange={() => toggleFile(f)} />
                    <a href={f.url} target="_blank" rel="noreferrer" title="Open in a new tab">{f.name}</a>
                  </div>
                ))}
                <button type="button" className="sb-sem-upbtn" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Uploading…' : '+ Upload a file'}
                </button>
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFilesChosen} />
              </div>
            </div>

            <label className="sb-sem-l">Add a personal note <span className="sb-sem-l-soft">(optional)</span>
              <textarea className="sb-sem-in sb-sem-body" rows={3} value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. It was a pleasure meeting with you today…" />
            </label>

            {err && <div className="sb-sem-warn">{err}</div>}
            <div className="sb-sem-actions">
              <button type="button" className="sb-sem-cancel" onClick={onClose} disabled={busy || savingDraft}>Close</button>
              <button type="button" className="sb-sem-cancel" onClick={handleSaveDraft} disabled={busy || savingDraft}
                title="Park this email — edit and send it later from Email drafts on this order">
                {savingDraft ? 'Saving…' : draftId ? 'Update draft' : 'Save as draft'}
              </button>
              <button type="button" className="sb-sem-go" disabled={busy || savingDraft || !toValid || nothingPicked} onClick={openGate}>
                {busy ? 'Preparing…' : 'Preview + send'}
              </button>
            </div>
          </>
        )}
      </div>

      <ConfirmSend open={!!gate} to={toList.join(', ')} subject={gate?.subject || ''} html={gate?.html || ''}
        busy={busy} onConfirm={doSend} onClose={() => setGate(null)} />
      <style>{CSS}</style>
    </div>
  )
}

const CSS = `
  .sb-sem-scrim { position: fixed; inset: 0; background: rgba(15,20,25,0.5); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .sb-sem { background: #fff; border-radius: 12px; width: 100%; max-width: 580px; max-height: 90vh; overflow-y: auto; padding: 20px 22px; }
  .sb-sem-title { font-size: 17px; font-weight: 800; }
  .sb-sem-sub { font-size: 12.5px; color: #6B6456; margin: 4px 0 10px; }
  .sb-sem-l { display: block; font-size: 11.5px; font-weight: 700; color: #6B6456; margin: 10px 0 0; }
  .sb-sem-l-soft { font-weight: 400; }
  .sb-sem-in { display: block; width: 100%; margin-top: 4px; border: 1px solid #D9D2C0; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13.5px; box-sizing: border-box; }
  .sb-sem-body { resize: vertical; line-height: 1.5; }
  .sb-sem-items { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .sb-sem-item { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #D9D2C0; border-radius: 10px; padding: 9px 11px; cursor: pointer; }
  .sb-sem-item.off { opacity: 0.55; cursor: default; }
  .sb-sem-item input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; }
  .sb-sem-item-l { display: block; font-size: 13.5px; font-weight: 700; color: #16150F; }
  .sb-sem-item-h { display: block; font-size: 12px; color: #6B6456; margin-top: 1px; font-weight: 400; }
  .sb-sem-files { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; max-height: 180px; overflow-y: auto; border: 1px solid #EAE4D6; border-radius: 10px; padding: 8px 10px; }
  .sb-sem-file { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  .sb-sem-file input { width: 15px; height: 15px; flex-shrink: 0; }
  .sb-sem-file a { color: #16150F; text-decoration: underline; text-decoration-color: #C9A468; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sb-sem-upbtn { align-self: flex-start; background: none; border: 1px dashed #C9A468; color: #9A7209; border-radius: 8px; padding: 5px 10px; font: 700 12.5px/1 inherit; cursor: pointer; margin-top: 3px; }
  .sb-sem-upbtn:disabled { opacity: 0.5; cursor: default; }
  .sb-sem-warn { background: rgba(179,38,30,0.08); color: #B3261E; font-size: 12.5px; border-radius: 8px; padding: 8px 10px; margin-top: 10px; }
  .sb-sem-note { font-size: 12.5px; color: #6B6456; margin-top: 6px; }
  .sb-sem-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
  .sb-sem-cancel { background: none; border: 1px solid #D9D2C0; border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
  .sb-sem-go { background: #16150F; color: #C9A468; border: none; border-radius: 8px; padding: 8px 16px; font: inherit; font-weight: 800; cursor: pointer; }
  .sb-sem-go:disabled { opacity: 0.5; cursor: default; }
`
