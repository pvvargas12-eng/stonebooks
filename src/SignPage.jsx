// =============================================================================
// SignPage — public remote contract signing (/sign/<token>)
// =============================================================================
// Rendered standalone (no CRM chrome, NO staff auth) when the URL path is
// /sign/<token>. Loads the contract via signing-load, lets the customer review
// the PDF, type their printed name, check the e-sign consent box, GENERATE a
// cursive (Dancing Script) signature from the typed name + today's date, and
// submit. On success they get a "Download your signed copy" button.
//
// The signature is type-name-to-cursive only — no draw pad. The signed PDF stamps
// the same name in the same Dancing Script font (embedded server-side via
// fontkit), so the stamped signature matches exactly what the signer saw here.
//
// Self-contained on purpose: it does NOT import SalesMode (11k+ lines) or the
// staff data layer — only src/lib/signing.js (which only needs the anon client).
// The ESIGN/UETA legal backbone is the consent checkbox + the audit trail the
// signing-submit function records (IP, user agent, timestamps, name, hash).
// =============================================================================
import { useEffect, useState } from 'react'
import { loadSigningRequest, submitSignature } from './lib/signing'

const BRONZE = '#9a6a3a'
const INK = '#0F1419'
const SCRIPT_FONT = "'Dancing Script', 'Brush Script MT', cursive"

const shell = { minHeight: '100vh', background: '#eef1f4', color: INK, fontFamily: 'Inter, system-ui, sans-serif', padding: '24px 16px' }
const card = { maxWidth: 820, margin: '0 auto', background: '#fff', borderRadius: 12, boxShadow: '0 2px 18px rgba(15,20,25,0.08)', overflow: 'hidden' }
const pad = { padding: '22px 26px' }
const btnPrimary = (enabled) => ({
  background: enabled ? INK : '#c4ccd4', color: '#fff', border: 'none', borderRadius: 8,
  padding: '13px 22px', fontSize: 15, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', width: '100%',
})

// Page shell — module-level so it isn't re-created each render. Loads the
// Dancing Script webfont so the on-screen cursive matches the stamped PDF.
function Frame({ children }) {
  return (
    <div style={shell}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap');"}</style>
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
  const [generated, setGenerated] = useState(false)  // cursive signature generated
  const [sigDate, setSigDate] = useState('')         // display date stamped with it
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

  // Editing the name (or un-checking consent) invalidates a generated signature —
  // the cursive must always match the name that gets submitted.
  const onNameChange = (v) => { setSignerName(v); if (generated) setGenerated(false) }
  const onConsentChange = (v) => { setConsent(v); if (!v && generated) setGenerated(false) }

  const canGenerate = !!(signerName.trim() && consent && !generated)
  const canSubmit = !!(generated && signerName.trim() && consent && !submitting)

  const handleGenerate = () => {
    if (!canGenerate) return
    // Event handler (not render) — new Date() is fine here.
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    setSigDate(today)
    setGenerated(true)
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true); setSubmitErr(null)
    try {
      // No image — the server stamps the typed name in the script font.
      const res = await submitSignature({ token, signerName: signerName.trim(), consent: true })
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

        {/* Print name */}
        <div style={{ marginTop: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Print name</label>
          <input
            value={signerName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Type your full name"
            style={{ width: '100%', padding: '12px 13px', fontSize: 15, border: '1px solid #cfd6de', borderRadius: 8, boxSizing: 'border-box' }}
          />
        </div>

        {/* Consent */}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 14, lineHeight: 1.45, cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={(e) => onConsentChange(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
          <span>I have reviewed this contract and agree to sign it electronically. I understand my electronic
            signature is legally binding, the same as a handwritten signature.</span>
        </label>

        {/* Generate */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          style={{
            ...btnPrimary(canGenerate), marginTop: 18, width: 'auto', padding: '11px 20px',
            background: canGenerate ? BRONZE : '#c4ccd4',
          }}
        >
          {generated ? 'Signature generated ✓' : 'Generate e-signature'}
        </button>
        {!generated && (
          <div style={{ color: '#6b7682', fontSize: 13, marginTop: 8 }}>
            Type your name and check the box, then generate your signature.
          </div>
        )}

        {/* Generated cursive signature + date */}
        {generated && (
          <div style={{ marginTop: 18, border: '1px solid #d7dee6', borderRadius: 10, background: '#fbfcfd', padding: '18px 20px', display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px', minWidth: 220 }}>
              <div style={{ fontFamily: SCRIPT_FONT, fontSize: 40, lineHeight: 1.1, color: INK, paddingBottom: 4, borderBottom: '1px solid #2b333b' }}>
                {signerName.trim()}
              </div>
              <div style={{ fontSize: 11, color: '#8a929b', marginTop: 4, letterSpacing: 0.4 }}>SIGNATURE</div>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 130 }}>
              <div style={{ fontSize: 16, color: INK, paddingBottom: 8, borderBottom: '1px solid #2b333b' }}>
                {sigDate}
              </div>
              <div style={{ fontSize: 11, color: '#8a929b', marginTop: 4, letterSpacing: 0.4 }}>DATE</div>
            </div>
          </div>
        )}

        {submitErr && <div style={{ marginTop: 14, color: '#b3261e', fontSize: 14 }}>⚠ {submitErr}</div>}

        {/* Submit */}
        <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{ ...btnPrimary(canSubmit), marginTop: 18 }}>
          {submitting ? 'Submitting…' : 'Sign & submit'}
        </button>
        {generated && !submitting && (
          <div style={{ color: '#6b7682', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
            Submitting applies this signature to your contract.
          </div>
        )}
      </div>
    </Frame>
  )
}
