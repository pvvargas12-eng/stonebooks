// =============================================================================
// SignPage — public remote contract signing (/sign/<token>)
// =============================================================================
// Rendered standalone (no CRM chrome, NO staff auth) when the URL path is
// /sign/<token>. Loads the contract via signing-load, lets the customer review
// the PDF, type their full name, check the e-sign consent box, draw a signature,
// and submit. On success they get a "Download your signed copy" button.
//
// Self-contained on purpose: it does NOT import SalesMode (11k+ lines) or the
// staff data layer — only src/lib/signing.js (which only needs the anon client).
// The ESIGN/UETA legal backbone is the consent checkbox + the audit trail the
// signing-submit function records (IP, user agent, timestamps, name, hash).
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { loadSigningRequest, submitSignature } from './lib/signing'

const BRONZE = '#9a6a3a'
const INK = '#0F1419'

// ── Minimal signature pad (pointer drawing on a canvas) ─────────────────────
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const lastRef = useRef(null)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Size the backing store to the displayed size for crisp lines.
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
  }, [])

  const pos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const t = e.touches?.[0]
    const cx = t ? t.clientX : e.clientX
    const cy = t ? t.clientY : e.clientY
    return { x: cx - rect.left, y: cy - rect.top }
  }

  const start = (e) => { e.preventDefault(); drawingRef.current = true; lastRef.current = pos(e) }
  const move = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(lastRef.current.x, lastRef.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    if (!hasInk) { setHasInk(true) }
    onChange?.(canvasRef.current.toDataURL('image/png'))
  }
  const end = () => { drawingRef.current = false; lastRef.current = null }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange?.(null)
  }

  return (
    <div>
      <div style={{ position: 'relative', border: `1px solid #cfd6de`, borderRadius: 8, background: '#fff' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 170, touchAction: 'none', display: 'block', borderRadius: 8, cursor: 'crosshair' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {!hasInk && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: '#9aa6b2', fontSize: 14 }}>
            Sign here
          </div>
        )}
      </div>
      <button type="button" onClick={clear}
        style={{ marginTop: 8, background: 'none', border: 'none', color: BRONZE, cursor: 'pointer', fontSize: 13, padding: 0 }}>
        Clear signature
      </button>
    </div>
  )
}

const shell = { minHeight: '100vh', background: '#eef1f4', color: INK, fontFamily: 'Inter, system-ui, sans-serif', padding: '24px 16px' }
const card = { maxWidth: 820, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 18px rgba(15,20,25,0.08)', overflow: 'hidden' }
const pad = { padding: '22px 26px' }
const btnPrimary = (enabled) => ({
  background: enabled ? INK : '#c4ccd4', color: '#fff', border: 'none', borderRadius: 8,
  padding: '13px 22px', fontSize: 15, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', width: '100%',
})

// Page shell — module-level so it isn't re-created each render.
function Frame({ children }) {
  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ background: INK, color: '#fff', padding: '18px 26px' }}>
          <div style={{ fontSize: 13, letterSpacing: 1.5, color: BRONZE, fontWeight: 600 }}>SHEVCHENKO MONUMENTS</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>Contract signature</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function SignPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [data, setData] = useState(null)          // loaded request
  const [signerName, setSignerName] = useState('')
  const [consent, setConsent] = useState(false)
  const [sigPng, setSigPng] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState(null)
  const [signedUrl, setSignedUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadErr(null)
    loadSigningRequest(token)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) { setLoadErr(res.error || 'This signing link could not be opened.'); return }
        setData(res)
        if (res.signer_prefill) setSignerName(res.signer_prefill)
      })
      .catch((e) => { if (!cancelled) setLoadErr(e.message || 'This signing link could not be opened.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  const canSubmit = !!(consent && sigPng && signerName.trim() && !submitting)

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true); setSubmitErr(null)
    try {
      const res = await submitSignature({ token, signaturePng: sigPng, signerName: signerName.trim(), consent: true })
      if (!res.ok) { setSubmitErr(res.error || 'Could not record your signature. Please try again.'); return }
      setSignedUrl(res.signed_url || null)
    } catch (e) {
      setSubmitErr(e.message || 'Could not record your signature. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Frame><div style={pad}>Loading your contract…</div></Frame>

  if (loadErr) return (
    <Frame><div style={pad}>
      <p style={{ fontSize: 15 }}>{loadErr}</p>
      <p style={{ color: '#6b7682', fontSize: 14 }}>If you believe this is a mistake, please contact Shevchenko Monuments at 732-442-1286.</p>
    </div></Frame>
  )

  // Terminal states from the loader.
  if (data && data.status && data.status !== 'viewed' && data.status !== 'pending') {
    const msg = data.status === 'signed'
      ? 'This contract has already been signed. Thank you!'
      : data.status === 'expired'
        ? 'This signing link has expired. Please contact Shevchenko Monuments for a new link.'
        : data.status === 'voided'
          ? 'This signing link is no longer active. Please contact Shevchenko Monuments.'
          : 'This signing link is not available.'
    return <Frame><div style={pad}><p style={{ fontSize: 15 }}>{msg}</p>
      <p style={{ color: '#6b7682', fontSize: 14 }}>Shevchenko Monuments · 732-442-1286</p></div></Frame>
  }

  // Success — signed.
  if (signedUrl) return (
    <Frame><div style={pad}>
      <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>✓ Your contract is signed</div>
      <p style={{ fontSize: 15, color: '#3a4753' }}>
        Thank you, {signerName.trim()}. A copy has been saved for Shevchenko Monuments. Download your signed copy below.
      </p>
      <a href={signedUrl} target="_blank" rel="noreferrer"
        style={{ ...btnPrimary(true), display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: 12, width: 'auto', padding: '13px 26px' }}>
        Download your signed copy
      </a>
    </div></Frame>
  )

  // Main signing flow.
  return (
    <Frame>
      <div style={pad}>
        <p style={{ fontSize: 15, marginTop: 0 }}>
          {data?.order_number ? <>Order <strong>{data.order_number}</strong>{data.surname ? <> · {data.surname}</> : null}. </> : null}
          Please review the contract below, then sign to accept.
        </p>

        {data?.pdf_url ? (
          <>
            <iframe src={data.pdf_url} title="Contract" style={{ width: '100%', height: 520, border: '1px solid #cfd6de', borderRadius: 8 }} />
            <a href={data.pdf_url} target="_blank" rel="noreferrer" style={{ color: BRONZE, fontSize: 13, display: 'inline-block', marginTop: 6 }}>
              Open contract in a new tab
            </a>
          </>
        ) : (
          <div style={{ color: '#6b7682', fontSize: 14 }}>The contract document is unavailable. Please contact the office.</div>
        )}

        <div style={{ marginTop: 22 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Your full legal name</label>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Type your full name"
            style={{ width: '100%', padding: '12px 13px', fontSize: 15, border: '1px solid #cfd6de', borderRadius: 8, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginTop: 18 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Signature</label>
          <SignaturePad onChange={setSigPng} />
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 14, lineHeight: 1.45, cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
          <span>I have reviewed this contract and agree to sign it electronically. I understand my electronic
            signature is legally binding, the same as a handwritten signature.</span>
        </label>

        {submitErr && <div style={{ marginTop: 14, color: '#b3261e', fontSize: 14 }}>⚠ {submitErr}</div>}

        <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{ ...btnPrimary(canSubmit), marginTop: 18 }}>
          {submitting ? 'Submitting…' : 'Sign & submit'}
        </button>
        {!canSubmit && !submitting && (
          <div style={{ color: '#6b7682', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
            Type your name, draw your signature, and check the box to enable signing.
          </div>
        )}
      </div>
    </Frame>
  )
}
