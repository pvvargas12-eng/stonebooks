// =============================================================================
// ApprovePage — PUBLIC customer approval surface (/approve/<token>).
// =============================================================================
// No staff auth, no app chrome, no navigation into the CRM. The token is the
// credential, validated server-side by approve-load / approve-submit (service
// role). This page only imports the tiny public approval client + DrawSignature —
// never SalesMode or the staff data layer. Mobile-first.
// =============================================================================

import { useEffect, useState } from 'react'
import { loadApprovalRequest, submitApproval } from './lib/approval'
import DrawSignature from './components/DrawSignature'

const TERMINAL = {
  signed:  { title: 'Already approved', body: 'This layout has already been approved. No further action is needed — thank you.' },
  revoked: { title: 'Link no longer active', body: 'This approval link has been replaced or withdrawn. Please contact Shevchenko Monuments for a current link.' },
  expired: { title: 'Link expired', body: 'This approval link has expired. Please contact Shevchenko Monuments to request a new one.' },
  not_found: { title: 'Link not found', body: 'This approval link isn’t valid. Please check the link or contact Shevchenko Monuments.' },
}

export default function ApprovePage({ token }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)        // { status, order_number, surname, signer_prefill, pdf_url }
  const [terminal, setTerminal] = useState(null) // a TERMINAL key
  const [sig, setSig] = useState({ image: null, typedName: '', ready: false })
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [doneUrl, setDoneUrl] = useState(null)

  useEffect(() => {
    let alive = true
    loadApprovalRequest(token).then(res => {
      if (!alive) return
      setLoading(false)
      if (!res.ok) { setTerminal(TERMINAL[res.error] ? res.error : 'not_found'); return }
      if (res.status && res.status !== 'viewed' && res.status !== 'pending') { setTerminal(TERMINAL[res.status] ? res.status : 'not_found'); return }
      setData(res)
    }).catch(() => { if (alive) { setLoading(false); setTerminal('not_found') } })
    return () => { alive = false }
  }, [token])

  const submit = async () => {
    if (!sig.ready || !consent || submitting) return
    setSubmitting(true); setError(null)
    const res = await submitApproval({ token, signerName: sig.typedName, consent, signatureImage: sig.image })
    setSubmitting(false)
    if (!res.ok) {
      if (TERMINAL[res.error]) { setTerminal(res.error); return }
      setError(res.error || 'Could not submit. Please try again.'); return
    }
    setDoneUrl(res.signed_url || '')
  }

  return (
    <div className="ap-shell">
      <style>{CSS}</style>
      <div className="ap-brand">
        <div className="ap-brand-name">Shevchenko Monuments</div>
        <div className="ap-brand-sub">Monument Layout Approval</div>
      </div>

      {loading && <div className="ap-card ap-center">Loading your layout…</div>}

      {!loading && terminal && (
        <div className="ap-card ap-center">
          <div className="ap-term-title">{TERMINAL[terminal].title}</div>
          <p className="ap-term-body">{TERMINAL[terminal].body}</p>
        </div>
      )}

      {!loading && doneUrl !== null && (
        <div className="ap-card ap-center">
          <div className="ap-done-check">✓</div>
          <div className="ap-term-title">Approved — thank you!</div>
          <p className="ap-term-body">Your approval has been recorded and sent to Shevchenko Monuments.</p>
          {doneUrl && <a className="ap-btn" href={doneUrl} target="_blank" rel="noreferrer">Download your signed copy</a>}
        </div>
      )}

      {!loading && !terminal && data && doneUrl === null && (
        <>
          <div className="ap-meta">
            {data.order_number ? <span>Order {data.order_number}</span> : null}
            {data.surname ? <span> · {data.surname}</span> : null}
          </div>

          <div className="ap-card ap-packet">
            <div className="ap-packet-label">Your monument layout</div>
            {data.pdf_url
              ? <iframe className="ap-pdf" title="Monument layout packet" src={data.pdf_url} />
              : <div className="ap-center">Packet unavailable — please contact us.</div>}
            {data.pdf_url && <a className="ap-link" href={data.pdf_url} target="_blank" rel="noreferrer">Open full-screen ↗</a>}
          </div>

          <div className="ap-card">
            <p className="ap-verify">
              I verify that the above pictured monument is <strong>approved to be produced</strong>.
              All <strong>spelling, dates, and designs are correct</strong>. I understand this proof is a
              representation of the actual color, and that the actual stone is a product of nature and will vary.
            </p>
            <DrawSignature onChange={setSig} />
            <label className="ap-consent">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>I have reviewed this layout and agree to approve it electronically.</span>
            </label>
            {error && <div className="ap-error">{error}</div>}
            <button type="button" className="ap-btn ap-btn-primary" disabled={!sig.ready || !consent || submitting} onClick={submit}>
              {submitting ? 'Submitting…' : 'Approve & sign'}
            </button>
            <div className="ap-fine">Shevchenko Monuments, LLC · Perth Amboy, NJ · est. 1919</div>
          </div>
        </>
      )}
    </div>
  )
}

const CSS = `
* { box-sizing: border-box; }
.ap-shell { min-height: 100vh; background: #f4f2ee; font-family: Inter, system-ui, -apple-system, sans-serif; color: #1a1a1a; padding: 16px; max-width: 720px; margin: 0 auto; }
.ap-brand { text-align: center; padding: 14px 0 10px; }
.ap-brand-name { font-size: 22px; font-weight: 800; color: #0f1419; letter-spacing: 0.01em; }
.ap-brand-sub { font-size: 13px; color: #9a7209; font-weight: 600; margin-top: 2px; }
.ap-meta { text-align: center; font-size: 13px; color: #8a8472; margin: 4px 0 12px; }
.ap-card { background: #fff; border: 1px solid #e7e2d6; border-radius: 12px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.ap-center { text-align: center; color: #6a655c; }
.ap-packet-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9a7209; margin-bottom: 8px; }
.ap-pdf { width: 100%; height: 62vh; min-height: 380px; border: 1px solid #e7e2d6; border-radius: 8px; background: #fff; }
.ap-link { display: inline-block; margin-top: 8px; color: #9a7209; font-weight: 600; font-size: 13px; text-decoration: none; }
.ap-verify { font-size: 13.5px; line-height: 1.55; color: #3a362f; margin: 0 0 14px; }
.ap-consent { display: flex; align-items: flex-start; gap: 9px; margin-top: 14px; font-size: 13.5px; color: #3a362f; line-height: 1.4; }
.ap-consent input { margin-top: 2px; width: 18px; height: 18px; flex: 0 0 auto; }
.ap-btn { display: block; width: 100%; text-align: center; border: 1px solid #9a7209; background: #fff; color: #9a7209; border-radius: 10px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; text-decoration: none; margin-top: 14px; }
.ap-btn-primary { background: #9a7209; color: #fff; }
.ap-btn:disabled { opacity: 0.5; cursor: default; }
.ap-error { color: #b3261e; font-size: 13.5px; margin-top: 12px; }
.ap-fine { text-align: center; font-size: 11px; color: #b3ac9d; margin-top: 14px; }
.ap-term-title { font-size: 18px; font-weight: 700; color: #0f1419; margin-bottom: 8px; }
.ap-term-body { font-size: 14px; color: #6a655c; line-height: 1.5; margin: 0; }
.ap-done-check { width: 56px; height: 56px; border-radius: 50%; background: #e8f5ea; color: #2d7a4f; font-size: 30px; line-height: 56px; margin: 0 auto 12px; }
`
