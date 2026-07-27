// =============================================================================
// SignContractScreen — View & Sign Contract on the sales iPad (SALES-2/4)
// =============================================================================
// Paul 2026-07-27: search the name → view the WHOLE contract → customer signs
// on glass → signed + copy saved → offer EMAIL: prefilled customer address,
// add/change multiple recipients, then the ConfirmSend gate (send-safety
// doctrine — nothing goes out on one click).
// iPad notes (SALES-4): iOS Safari shows only the first slice of a PDF in an
// iframe, so the contract renders through pdf.js — every page as a canvas,
// stacked full-width, the page itself scrolls. pdf.js loads from cdnjs on
// demand (the repo's jsPDF pattern; no npm dependency).
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  searchOrdersLight, createJobFromOrder, logOrderActivity, uploadOrderAttachment,
  sendShopEmail,
} from '../lib/stonebooksData'
import {
  rowToOrder, saveOrder, uploadSignature, generateContractPDF, SignatureCanvas,
} from '../SalesMode'
import ConfirmSend from '../components/ConfirmSend'
import { isLeadRaw, familyNameOf } from './fieldShared'

const fmtDay = (iso) => {
  const d = new Date(iso || 0)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── pdf.js from cdnjs, on demand (the jsPDF loader pattern) ─────────────────
let _pdfjsPromise = null
function loadPdfJs() {
  if (window.pdfjsLib?.getDocument) return Promise.resolve(window.pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.async = true
    script.onload = () => {
      const lib = window.pdfjsLib
      if (!lib) { reject(new Error('pdf.js loaded but global not found')); return }
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(lib)
    }
    script.onerror = () => {
      _pdfjsPromise = null
      reject(new Error('Failed to load the PDF viewer — check internet connection'))
    }
    document.head.appendChild(script)
  })
  return _pdfjsPromise
}

// Every page of the PDF as a crisp canvas, stacked — the WHOLE document,
// scrolled by the page itself (no inner scroll trap for iPad thumbs).
function PdfPages({ bytes }) {
  const hostRef = useRef(null)
  const [state, setState] = useState('loading')   // loading | ok | error
  const [errMsg, setErrMsg] = useState(null)

  useEffect(() => {
    if (!bytes) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await loadPdfJs()
        // pdf.js DETACHES the buffer it is given — hand it a copy so a rerender
        // (StrictMode double-effect) never reads a neutered ArrayBuffer.
        const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
        if (cancelled) return
        const host = hostRef.current
        if (!host) return
        host.innerHTML = ''
        const width = Math.min(host.clientWidth || 820, 900)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const scale = width / base.width
          const vp = page.getViewport({ scale: scale * dpr })
          const canvas = document.createElement('canvas')
          canvas.width = vp.width
          canvas.height = vp.height
          canvas.style.width = `${width}px`
          canvas.style.height = `${(vp.height / dpr)}px`
          canvas.style.display = 'block'
          canvas.style.margin = '0 auto 14px'
          canvas.style.background = '#fff'
          canvas.style.borderRadius = '10px'
          canvas.style.boxShadow = '0 1px 8px rgba(22,21,15,0.12)'
          host.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        }
        if (!cancelled) setState('ok')
      } catch (e) {
        if (!cancelled) { setErrMsg(e?.message || 'Could not render the contract.'); setState('error') }
      }
    })()
    return () => { cancelled = true }
  }, [bytes])

  return (
    <div>
      {state === 'loading' && <div className="fl-empty">Preparing the contract…</div>}
      {state === 'error' && <div className="fl-empty">{errMsg}</div>}
      <div ref={hostRef} />
    </div>
  )
}

// ── Recipient chips — prefill, add, remove, multiple ────────────────────────
function RecipientEditor({ emails, setEmails }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const e = draft.trim().toLowerCase()
    if (!e) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return
    if (!emails.includes(e)) setEmails([...emails, e])
    setDraft('')
  }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {emails.map(e => (
          <span key={e} className="sc-mailchip">
            {e}
            <button type="button" aria-label={`Remove ${e}`} onClick={() => setEmails(emails.filter(x => x !== e))}>×</button>
          </span>
        ))}
        {emails.length === 0 && <span className="fl-spec">No email on file — add one below.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="fl-input" type="email" inputMode="email" placeholder="Add an email address…"
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          style={{ flex: 1 }} />
        <button type="button" className="fl-verb" style={{ height: 'auto' }} onClick={add}
          disabled={!draft.trim()}>ADD</button>
      </div>
    </div>
  )
}

export default function SignContractScreen({ who, onClose }) {
  const [stage, setStage] = useState('search')   // search | review | sign | done
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [row, setRow] = useState(null)           // full DB row
  const [order, setOrder] = useState(null)       // mapped order
  const [pdfBytes, setPdfBytes] = useState(null) // ArrayBuffer for the viewer
  const [pdfErr, setPdfErr] = useState(null)
  const [sig, setSig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // The signed copy, captured at commit for the email attachment.
  const [signedPdf, setSignedPdf] = useState(null)  // { base64, filename }
  const [emails, setEmails] = useState([])
  const [gateOpen, setGateOpen] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [sentTo, setSentTo] = useState(null)

  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) { setHits([]); return undefined }
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchOrdersLight(needle, 14).catch(() => [])
      if (!cancelled) setHits(rows)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q])

  const pick = async (hit) => {
    setBusy(true); setErr(null); setPdfErr(null)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customer:customers(*), cemetery:cemeteries(*)')
        .eq('id', hit.id)
        .single()
      if (error) throw new Error(error.message)
      const mapped = rowToOrder(data, data.customer, data.cemetery)
      setRow(data); setOrder(mapped); setSig(null); setSignedPdf(null); setSentTo(null)
      setEmails(data.customer?.email ? [String(data.customer.email).trim().toLowerCase()] : [])
      setStage('review')
      setPdfBytes(null)
      const { doc } = await generateContractPDF(mapped, { returnDoc: true })
      setPdfBytes(doc.output('arraybuffer'))
    } catch (e) {
      setPdfErr(e?.message || 'Could not render the contract.')
    }
    setBusy(false)
  }

  // The commit — mirrors the desk's convert flow exactly.
  const commit = async () => {
    if (!sig || !order || busy) return
    setBusy(true); setErr(null)
    try {
      const custUp = await uploadSignature(sig, 'customer', order.id)
      const now = new Date().toISOString()
      const signedOrder = {
        ...order,
        status: 'contracted',
        customerSignature: null,
        customerSignatureUrl: custUp.url,
        customerSignaturePath: custUp.path,
        signedAt: now,
        pricingLockedAt: order.pricingLockedAt || now,
      }
      const res = await saveOrder(signedOrder)
      if (!res.ok) throw new Error(res.error?.message || res.reason || 'Save failed')

      try { await createJobFromOrder(order.id, { source: 'sales-ipad' }) } catch { /* backfill banner recovers */ }

      // The COPY: regenerate with the uploaded signature embedded — saved to
      // the order AND kept in memory for the email step.
      const fam = familyNameOf(row) || 'contract'
      const filename = `Contract SIGNED - ${fam} - ${now.slice(0, 10)}.pdf`
      try {
        const { doc } = await generateContractPDF(signedOrder, { returnDoc: true })
        const blob = doc.output('blob')
        await uploadOrderAttachment(order.id, new File([blob], filename, { type: 'application/pdf' }))
        const base64 = await new Promise((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).split(',')[1])
          r.onerror = reject
          r.readAsDataURL(blob)
        })
        setSignedPdf({ base64, filename })
      } catch (e) { console.warn('signed-copy attach:', e) }

      logOrderActivity(order.id, {
        type: 'contract',
        note: `Contract signed on the sales iPad${who?.name ? ` (with ${who.name})` : ''}`,
      }).catch(() => {})

      setOrder(signedOrder)
      setStage('done')
    } catch (e) {
      setErr(e?.message || 'Could not complete signing.')
    }
    setBusy(false)
  }

  // The send — behind the ConfirmSend gate, per the send-safety doctrine.
  const emailSubject = row ? `Your signed contract — ${familyNameOf(row)} (${row.order_number || ''})`.trim() : ''
  const emailBody = row
    ? `Dear ${row.customer?.first_name || 'valued customer'},\n\nThank you for trusting Shevchenko Monuments with your family's memorial. Your signed contract is attached for your records.\n\nIf you have any questions, reply to this email or call us any time.\n\nShevchenko Monuments\nFamily-owned since 1919`
    : ''
  const doSend = async () => {
    if (!signedPdf || emails.length === 0 || sendBusy) return
    setSendBusy(true)
    const res = await sendShopEmail({
      to: emails.join(', '),
      subject: emailSubject,
      text: emailBody,
      attachments: [{ filename: signedPdf.filename, contentBase64: signedPdf.base64, contentType: 'application/pdf' }],
      orderId: order?.id || null,
      customerId: row?.customer?.id || null,
    })
    setSendBusy(false)
    if (!res.ok) { setErr(res.error || 'Send failed.'); setGateOpen(false); return }
    setGateOpen(false)
    setSentTo(emails.join(', '))
    logOrderActivity(order.id, { type: 'email', note: `Signed contract emailed to ${emails.join(', ')}` }).catch(() => {})
  }

  const alreadySigned = !!(order && order.signedAt)

  // ── SEARCH ─────────────────────────────────────────────────────────────────
  if (stage === 'search') {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <style>{SIGN_CSS}</style>
        <button type="button" className="fl-rowline" onClick={onClose}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Back</span>
        </button>
        <div className="fl-sect"><span className="fl-sect-h" style={{ fontSize: 24 }}>View and sign contract</span></div>
        <input className="fl-input" autoFocus placeholder="Family name or order number&hellip;"
          value={q} onChange={e => setQ(e.target.value)} style={{ fontSize: 18, padding: '16px 18px' }} />
        {hits.map(o => (
          <button key={o.id} type="button" className="fl-row fl-row-flex" disabled={busy} onClick={() => pick(o)}>
            <div className="fl-row-main">
              <div className="fl-fam" style={{ fontSize: 17 }}>
                {String(o.primary_lastname || '').toUpperCase() || o.order_number || 'Order'}
                {isLeadRaw(o) && <span className="fl-chip fl-c-lead" style={{ marginLeft: 8, verticalAlign: 'middle' }}>LEAD</span>}
              </div>
              <div className="fl-spec">{[o.order_number, o.cemetery?.name].filter(Boolean).join(' · ')}</div>
            </div>
            {o.signed_at
              ? <span className="fl-chip fl-c-good">SIGNED</span>
              : <span className="fl-chip fl-c-warn">UNSIGNED</span>}
            <span className="fl-chev">&#8250;</span>
          </button>
        ))}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div className="fl-empty">No matching order — check the spelling, or create the order first.</div>
        )}
      </div>
    )
  }

  // ── DONE (+ email) ─────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <style>{SIGN_CSS}</style>
        <div style={{ textAlign: 'center', paddingTop: '4dvh' }}>
          <div className="fl-sect-h" style={{ fontSize: 34, fontFamily: 'Fraunces, Georgia, serif' }}>Signed.</div>
          <div style={{ fontSize: 17, color: '#55503F', lineHeight: 1.6, margin: '12px 0 8px' }}>
            {familyNameOf(row)}&rsquo;s contract is signed and the copy is saved on the order.
          </div>
        </div>

        <div className="sc-mailcard">
          <div className="fl-sect" style={{ marginTop: 0 }}>
            <span className="fl-sect-h">Email the signed contract</span>
          </div>
          {sentTo ? (
            <div style={{ fontSize: 15.5, color: '#1d7a55', fontWeight: 700, padding: '6px 0' }}>
              Sent to {sentTo}.
            </div>
          ) : signedPdf ? (
            <>
              <RecipientEditor emails={emails} setEmails={setEmails} />
              <div className="fl-spec" style={{ margin: '10px 0 2px' }}>
                Attaches: {signedPdf.filename}
              </div>
              {err && <div className="fl-login-err" style={{ marginTop: 8 }}>{err}</div>}
              <button type="button" className="fl-btn-gold" style={{ marginTop: 12 }}
                disabled={emails.length === 0} onClick={() => { setErr(null); setGateOpen(true) }}>
                Review and send
              </button>
            </>
          ) : (
            <div className="fl-spec">The signed copy is still saving — one moment, then reopen this order to email it.</div>
          )}
        </div>

        <button type="button" className="fl-btn-ghost" style={{ marginTop: 14 }}
          onClick={() => { setStage('search'); setQ(''); setHits([]); setRow(null); setOrder(null); setPdfBytes(null); setSentTo(null) }}>
          Done
        </button>

        <ConfirmSend open={gateOpen} to={emails.join(', ')} subject={emailSubject} text={emailBody}
          busy={sendBusy} onConfirm={doSend} onClose={() => setGateOpen(false)}
          confirmLabel={`Send to ${emails.length} ${emails.length === 1 ? 'address' : 'addresses'}`} />
      </div>
    )
  }

  // ── REVIEW + SIGN ──────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <style>{SIGN_CSS}</style>
      <button type="button" className="fl-rowline"
        onClick={() => {
          if (stage === 'sign') { setStage('review'); return }
          setStage('search'); setPdfBytes(null)
        }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Back</span>
      </button>

      <div className="fl-sect">
        <span className="fl-sect-h" style={{ fontSize: 24 }}>{familyNameOf(row)}</span>
        <span className="fl-spec" style={{ marginLeft: 10 }}>{row?.order_number}</span>
        {alreadySigned && <span className="fl-chip fl-c-good" style={{ marginLeft: 'auto' }}>SIGNED {fmtDay(order.signedAt)}</span>}
      </div>

      {stage === 'review' && (
        <>
          {pdfErr && <div className="fl-empty">{pdfErr}</div>}
          {!pdfErr && pdfBytes && <PdfPages bytes={pdfBytes} />}
          {!pdfErr && !pdfBytes && <div className="fl-empty">Preparing the contract…</div>}
          {!alreadySigned && pdfBytes && (
            <div className="sc-stickybar">
              <button type="button" className="fl-btn-gold" onClick={() => setStage('sign')}>
                Ready to sign
              </button>
            </div>
          )}
        </>
      )}

      {stage === 'sign' && !alreadySigned && (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ fontSize: 16, color: '#55503F', lineHeight: 1.6, margin: '6px 0 14px' }}>
            By signing below I acknowledge I have reviewed the contract for
            {' '}{familyNameOf(row)} ({row?.order_number}) and agree to its terms.
          </div>
          <SignatureCanvas value={sig} onChange={setSig} label="Customer signature" />
          {err && <div className="fl-login-err" style={{ marginTop: 10 }}>{err}</div>}
          <button type="button" className="fl-btn-gold" style={{ marginTop: 16 }}
            disabled={!sig || busy} onClick={commit}>
            {busy ? 'Saving…' : 'Sign the contract'}
          </button>
        </div>
      )}
    </div>
  )
}

// Mirrored .sm-signature* (SalesMode's <style> isn't mounted on /sales — the
// DesignPacket precedent) + the SALES-4 iPad pieces: mail chips, sticky sign
// bar, a taller pad for iPad fingers.
const SIGN_CSS = `
  .sm-signature-label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #9A7209; font-weight: 700; margin-bottom: 6px; }
  .sm-signature-pad { position: relative; background: #fff; border: 2px solid #c9c9c4; border-radius: 12px; height: 260px; overflow: hidden; cursor: crosshair; touch-action: none; user-select: none; }
  .sm-signature-pad.disabled { cursor: not-allowed; opacity: 0.85; }
  .sm-signature-canvas { width: 100%; height: 100%; display: block; }
  .sm-signature-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; color: #b0b0ac; font-style: italic; font-size: 15px; }
  .sm-signature-actions { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
  .sm-signature-ok { font-size: 12px; letter-spacing: 0.06em; color: #1f7a3d; font-weight: 700; }
  .sm-link-btn { background: none; border: none; color: #9A7209; font: 700 14px/1 inherit; cursor: pointer; padding: 6px 2px; }
  .sc-mailcard { background: #fff; border: 1.5px solid #E2DCCE; border-radius: 16px; padding: 18px 20px; margin-top: 22px; }
  .sc-mailchip { display: inline-flex; align-items: center; gap: 7px; background: #F4EBD4; border: 1px solid #9A7209; color: #6d5106; border-radius: 999px; padding: 8px 8px 8px 14px; font-size: 14.5px; font-weight: 700; }
  .sc-mailchip button { border: none; background: #9A7209; color: #fff; width: 24px; height: 24px; border-radius: 999px; font-size: 14px; line-height: 1; cursor: pointer; }
  .sc-stickybar { position: sticky; bottom: 12px; padding: 10px 0; }
  .sc-stickybar .fl-btn-gold { box-shadow: 0 8px 26px rgba(22,21,15,0.25); }
`
