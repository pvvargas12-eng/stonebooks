// =============================================================================
// SalesKioskApp — STONEBOOKS SALES · the customer-facing iPad at /sales
// =============================================================================
// Paul: "this is only for customers — I can give them an iPad and they can do
// 2 things: fill out the intake form and search the catalog." A locked kiosk
// with exactly two doors and ZERO CRM chrome:
//   • Get started with us  → the self-service IntakeScreen (staff-gated exits)
//   • Browse our designs   → the read-only CatalogScreen
// Auth rides the device's persisted staff session (sign in once — or open a
// /field#k= link once; the same session serves /sales). Customers never see a
// login unless the device was never set up. No tabs, no bell, no money, no
// other customers' anything.
// =============================================================================
import { useState, useEffect } from 'react'
import { getSession, onAuthStateChange, signInWithPassword } from './lib/auth'
import { loadEmployees } from './lib/employees'
import { FIELD_CSS } from './field/fieldUndo'
import { getFieldWho } from './field/fieldIdentity'
import { redeemFieldLinkIfPresent } from './field/fieldLink'
import IntakeScreen from './field/IntakeScreen'
import CatalogScreen from './field/CatalogScreen'
import SignContractScreen from './field/SignContractScreen'

// One-time device setup — plain staff sign-in, kiosk-branded.
function KioskLogin() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    // Paul 2026-07-27: "username sales" — a plain username expands to the
    // kiosk account's real email; a full email still works for any staff.
    const raw = email.trim()
    const addr = raw.includes('@') ? raw : `${raw.toLowerCase()}@shevcoteam.app`
    const res = await signInWithPassword(addr, pw)
    setBusy(false)
    if (!res.ok) setErr(res.error || 'Sign-in failed.')
  }
  return (
    <div className="fl-login">
      <div className="fl-login-brand">STONEBOOKS <em>SALES</em></div>
      <div className="fl-login-sub">One-time device setup — staff sign-in</div>
      <form onSubmit={submit} className="fl-login-form">
        <input type="text" inputMode="email" autoComplete="username" placeholder="Username or email"
          value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Password"
          value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="fl-login-err">{err}</div>}
        <button type="submit" disabled={busy || !email.trim() || !pw}>
          {busy ? 'Signing in…' : 'Set up this device'}
        </button>
      </form>
    </div>
  )
}

export default function SalesKioskApp() {
  const [authed, setAuthed] = useState(undefined)
  const [ready, setReady] = useState(false)
  const [who, setWho] = useState(null)
  const [door, setDoor] = useState(null)   // null landing | 'intake' | 'catalog'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await redeemFieldLinkIfPresent().catch(() => false)
      const s = await getSession()
      if (!cancelled) setAuthed(!!s)
    })()
    const unsub = onAuthStateChange(u => setAuthed(!!u))
    return () => { cancelled = true; unsub() }
  }, [])

  // Roster → the device's pinned person (stamps salesRep on intake leads and
  // arms the staff PIN gates). A device with no pick still works — the intake
  // gates fall back to the deliberate two-tap.
  useEffect(() => {
    if (!authed) return
    let cancelled = false
    loadEmployees().catch(() => {}).then(() => {
      if (cancelled) return
      setWho(getFieldWho())
      setReady(true)
    })
    return () => { cancelled = true }
  }, [authed])

  if (authed === undefined) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><div className="fl-loading">Loading…</div></div>
  }
  if (!authed) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><KioskLogin /></div>
  }
  if (!ready) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><div className="fl-loading">Loading…</div></div>
  }

  if (door === 'intake') {
    return (
      <div className="fl-shell">
        <style>{FIELD_CSS}</style>
        <IntakeScreen who={who} onClose={() => setDoor(null)} />
      </div>
    )
  }

  if (door === 'sign') {
    return (
      <div className="fl-shell">
        <style>{FIELD_CSS}</style>
        <main className="fl-body" style={{ maxWidth: 900, margin: '0 auto' }}>
          <SignContractScreen who={who} onClose={() => setDoor(null)} />
        </main>
      </div>
    )
  }

  return (
    <div className="fl-shell">
      <style>{FIELD_CSS}</style>
      <main className="fl-body" style={{ maxWidth: 760, margin: '0 auto' }}>
        {door === 'catalog' ? (
          <CatalogScreen onBack={() => setDoor(null)} backLabel="Back" />
        ) : (
          <div style={{ paddingTop: '8dvh', textAlign: 'center' }}>
            <img src="/sb-sales-icon-180.png" alt="" width="76" height="76"
              style={{ borderRadius: 18, border: '1px solid #E2DCCE', marginBottom: 14 }} />
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', color: '#6B6456' }}>
              STONEBOOKS <span style={{ color: '#9A7209' }}>SALES</span>
            </div>
            <div className="fl-serif" style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 42, fontWeight: 600, color: '#16150F', margin: '14px 0 10px', lineHeight: 1.1 }}>
              Welcome.
            </div>
            <div style={{ fontSize: 16.5, color: '#55503F', lineHeight: 1.6, maxWidth: 440, margin: '0 auto 30px' }}>
              Since 1919, families have trusted us with their memorials.
              How can we help you today?
            </div>
            <div style={{ display: 'grid', gap: 14, maxWidth: 520, margin: '0 auto' }}>
              <button type="button" className="fi-kiosk-door" onClick={() => setDoor('catalog')}>
                <span className="nm">View Catalog</span>
                <span className="ds">Explore monuments by shape and style</span>
              </button>
              <button type="button" className="fi-kiosk-door" onClick={() => setDoor('intake')}>
                <span className="nm">Customer Intake</span>
                <span className="ds">Tell us a few details — it takes about two minutes</span>
              </button>
              <button type="button" className="fi-kiosk-door" onClick={() => setDoor('sign')}>
                <span className="nm">View and Sign Contract</span>
                <span className="ds">Review your contract and sign it right here</span>
              </button>
            </div>
          </div>
        )}
      </main>
      <style>{KIOSK_CSS}</style>
    </div>
  )
}

const KIOSK_CSS = `
  .fi-kiosk-door { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; background: #fff; border: 1.5px solid #E2DCCE; border-radius: 18px; padding: 22px 24px; cursor: pointer; font-family: inherit; min-height: 92px; }
  .fi-kiosk-door:active { background: #FBFAF6; border-color: #9A7209; }
  .fi-kiosk-door .nm { font-family: Fraunces, Georgia, serif; font-size: 23px; font-weight: 600; color: #16150F; }
  .fi-kiosk-door .ds { font-size: 14px; color: #8A7F6C; }
`
