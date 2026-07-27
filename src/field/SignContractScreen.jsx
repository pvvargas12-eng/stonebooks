// =============================================================================
// SignContractScreen — View & Sign Contract on the sales iPad (SALES-2)
// =============================================================================
// Paul 2026-07-27: "instead of me printing it or having them get it emailed i
// will take out the ipad search the name i just made click on the order and
// view and sign contract then once they sign it will move to signed and save
// that copy." Three stages: SEARCH (the name he just made) → REVIEW (the real
// contract, rendered by the SAME generator the desk uses) → SIGN (the desk's
// SignatureCanvas). Commit = the desk's convert flow: signature uploaded,
// order → contracted + signed_at + pricing locked, job created, and the
// SIGNED contract PDF saved onto the order's attachments as the copy.
// Already-signed orders open view-only — signing happens once.
// =============================================================================
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  searchOrdersLight, createJobFromOrder, logOrderActivity, uploadOrderAttachment,
} from '../lib/stonebooksData'
import {
  rowToOrder, saveOrder, uploadSignature, generateContractPDF, SignatureCanvas,
} from '../SalesMode'
import { isLeadRaw, familyNameOf } from './fieldShared'

const fmtDay = (iso) => {
  const d = new Date(iso || 0)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export default function SignContractScreen({ who, onClose }) {
  const [stage, setStage] = useState('search')   // search | review | sign | done
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [row, setRow] = useState(null)           // full DB row
  const [order, setOrder] = useState(null)       // mapped order
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfErr, setPdfErr] = useState(null)
  const [sig, setSig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const urlRef = useRef(null)

  // Search-as-you-type (the InstallList grammar).
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

  const revokePdf = () => { if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null } }
  useEffect(() => () => revokePdf(), [])

  // Pick a result → load the full row, map it, render the REAL contract.
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
      setRow(data); setOrder(mapped); setSig(null)
      setStage('review')
      revokePdf(); setPdfUrl(null)
      const { doc } = await generateContractPDF(mapped, { returnDoc: true })
      const url = URL.createObjectURL(doc.output('blob'))
      urlRef.current = url
      setPdfUrl(url)
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

      // Operational job — same isolated best-effort as the desk.
      try { await createJobFromOrder(order.id, { source: 'sales-ipad' }) } catch { /* backfill banner recovers */ }

      // The COPY: regenerate with the uploaded signature embedded, save onto
      // the order's attachments.
      try {
        const { doc } = await generateContractPDF(signedOrder, { returnDoc: true })
        const blob = doc.output('blob')
        const fam = familyNameOf(row) || 'contract'
        const file = new File([blob], `Contract SIGNED - ${fam} - ${now.slice(0, 10)}.pdf`, { type: 'application/pdf' })
        await uploadOrderAttachment(order.id, file)
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

  const alreadySigned = !!(order && order.signedAt)

  // ── SEARCH ─────────────────────────────────────────────────────────────────
  if (stage === 'search') {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button type="button" className="fl-rowline" onClick={onClose}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Back</span>
        </button>
        <div className="fl-sect"><span className="fl-sect-h">View and sign contract</span></div>
        <input className="fl-input" autoFocus placeholder="Family name or order number&hellip;"
          value={q} onChange={e => setQ(e.target.value)} style={{ fontSize: 17, padding: '14px 16px' }} />
        {hits.map(o => (
          <button key={o.id} type="button" className="fl-row fl-row-flex" disabled={busy} onClick={() => pick(o)}>
            <div className="fl-row-main">
              <div className="fl-fam">
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

  // ── DONE ───────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', paddingTop: '10dvh' }}>
        <div className="fl-sect-h" style={{ fontSize: 30, fontFamily: 'Fraunces, Georgia, serif' }}>Signed.</div>
        <div style={{ fontSize: 16, color: '#55503F', lineHeight: 1.6, margin: '14px 0 26px' }}>
          {familyNameOf(row)}&rsquo;s contract is signed and the copy is saved on the order.
          Thank you.
        </div>
        <button type="button" className="fl-btn-gold" style={{ maxWidth: 320, margin: '0 auto' }}
          onClick={() => { setStage('search'); setQ(''); setHits([]); setRow(null); setOrder(null); revokePdf(); setPdfUrl(null) }}>
          Done
        </button>
      </div>
    )
  }

  // ── REVIEW + SIGN ──────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <style>{SIGN_CSS}</style>
      <button type="button" className="fl-rowline"
        onClick={() => {
          if (stage === 'sign') { setStage('review'); return }
          setStage('search'); revokePdf(); setPdfUrl(null)
        }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#6B6456' }}>&#8249; Back</span>
      </button>

      <div className="fl-sect">
        <span className="fl-sect-h">{familyNameOf(row)}</span>
        <span className="fl-spec" style={{ marginLeft: 10 }}>{row?.order_number}</span>
        {alreadySigned && <span className="fl-chip fl-c-good" style={{ marginLeft: 'auto' }}>SIGNED {fmtDay(order.signedAt)}</span>}
      </div>

      {stage === 'review' && (
        <>
          {pdfErr && <div className="fl-empty">{pdfErr}</div>}
          {!pdfErr && !pdfUrl && <div className="fl-empty">Preparing the contract&hellip;</div>}
          {pdfUrl && (
            <iframe title="Contract" src={pdfUrl}
              style={{ width: '100%', height: '62dvh', border: '1.5px solid #E2DCCE', borderRadius: 14, background: '#fff' }} />
          )}
          {!alreadySigned && pdfUrl && (
            <button type="button" className="fl-btn-gold" style={{ marginTop: 14 }} onClick={() => setStage('sign')}>
              Ready to sign
            </button>
          )}
        </>
      )}

      {stage === 'sign' && !alreadySigned && (
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 15, color: '#55503F', lineHeight: 1.6, margin: '6px 0 14px' }}>
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

// Mirrored from SalesMode's .sm-signature* (its <style> isn't mounted on
// /sales — same precedent as DesignPacket). Pad is taller for iPad fingers.
const SIGN_CSS = `
  .sm-signature-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #9A7209; font-weight: 700; margin-bottom: 6px; }
  .sm-signature-pad { position: relative; background: #fff; border: 2px solid #c9c9c4; border-radius: 10px; height: 220px; overflow: hidden; cursor: crosshair; touch-action: none; user-select: none; }
  .sm-signature-pad.disabled { cursor: not-allowed; opacity: 0.85; }
  .sm-signature-canvas { width: 100%; height: 100%; display: block; }
  .sm-signature-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; color: #b0b0ac; font-style: italic; font-size: 14px; }
  .sm-signature-actions { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
  .sm-signature-ok { font-size: 12px; letter-spacing: 0.06em; color: #1f7a3d; font-weight: 700; }
  .sm-link-btn { background: none; border: none; color: #9A7209; font: 700 13px/1 inherit; cursor: pointer; padding: 6px 2px; }
`
