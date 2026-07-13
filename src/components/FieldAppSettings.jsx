// =============================================================================
// FieldAppSettings — Settings → Field app
// =============================================================================
// The desktop's front door to Field Mode: the /field link, and a one-click
// setup email to any staff member with the sign-in pointer and the
// add-to-home-screen steps. Email rides the existing reviewable path
// (sendOrderEmail with orderId:null — same as the vendor composer).
// =============================================================================
import { useState } from 'react'
import { sendOrderEmail } from '../lib/stonebooksData'

const fieldUrl = () =>
  (typeof window !== 'undefined' ? window.location.origin : 'https://stonebooks.vercel.app') + '/field'

const setupBody = (url) => `Stonebooks Field — phone setup

This is the crew app: today's installs, production statuses, order lookups with the approved layout, and final photos — from the cemetery.

1. SIGN IN
Open this link on your iPhone and sign in with your normal Stonebooks email and password:
${url}

2. PUT IT ON YOUR HOME SCREEN
- In Safari, tap the Share button (the square with the arrow, bottom center)
- Scroll down and tap "Add to Home Screen"
- Tap "Add" (top right)

You'll get an SB icon on your home screen that opens full-screen like a regular app. Sign-in sticks, the camera works for final photos, and Directions opens Maps.

Questions - call the office.
Shevchenko Monuments`

export default function FieldAppSettings() {
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // { ok, msg }
  const url = fieldUrl()

  const send = async () => {
    const dest = to.trim()
    if (!dest || busy) return
    setBusy(true); setResult(null)
    const res = await sendOrderEmail({
      orderId: null,
      to: dest,
      subject: 'Stonebooks Field — get it on your phone',
      body: setupBody(url),
    })
    setBusy(false)
    setResult(res.ok
      ? { ok: true, msg: `Setup email sent to ${dest}.` }
      : { ok: false, msg: res.error || 'Send failed — check the email integration in Settings → Integrations.' })
    if (res.ok) setTo('')
  }

  return (
    <div className="sb-settings-card">
      <h2 className="sb-settings-h2">Field app</h2>
      <p className="sb-settings-note">
        The phone app for the truck: installs, production statuses, order lookups with the
        approved layout, exact-spot marking, inventory, and final photos. It uses the same
        staff logins — nobody needs a new account.
      </p>

      <div style={{ margin: '14px 0 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9a8a5e', marginBottom: 4 }}>
          Field app link
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 13, background: 'rgba(154,114,9,0.08)', border: '1px solid rgba(154,114,9,0.25)', borderRadius: 8, padding: '7px 12px' }}>{url}</code>
          <button type="button" className="sb-btn"
            onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}) }}>
            Copy link
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9a8a5e', marginBottom: 4 }}>
        Send setup instructions
      </div>
      <p className="sb-settings-note" style={{ marginTop: 0 }}>
        Emails the link plus the add-to-home-screen steps (Safari Share → Add to Home Screen).
        They sign in with their existing Stonebooks password.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="email" placeholder="crew@email.com" value={to}
          onChange={e => setTo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #d8d2c6', borderRadius: 8, minWidth: 240 }} />
        <button type="button" className="sb-btn sb-btn-primary" disabled={busy || !to.trim()} onClick={send}>
          {busy ? 'Sending…' : 'Send setup email'}
        </button>
      </div>
      {result && (
        <p style={{ fontSize: 13, marginTop: 10, color: result.ok ? '#1D9E75' : '#B3261E' }}>{result.msg}</p>
      )}
    </div>
  )
}
