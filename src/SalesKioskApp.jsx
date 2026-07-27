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
      <div className="fl-shell sk-ipad">
        <style>{FIELD_CSS}</style>
        <style>{KIOSK_CSS}</style>
        <IntakeScreen who={who} onClose={() => setDoor(null)} />
      </div>
    )
  }

  if (door === 'sign') {
    return (
      <div className="fl-shell sk-ipad">
        <style>{FIELD_CSS}</style>
        <style>{KIOSK_CSS}</style>
        <main className="fl-body">
          <SignContractScreen who={who} onClose={() => setDoor(null)} />
        </main>
      </div>
    )
  }

  return (
    <div className="fl-shell sk-ipad">
      <style>{FIELD_CSS}</style>
      <style>{KIOSK_CSS}</style>
      <main className="fl-body">
        {door === 'catalog' ? (
          <CatalogScreen onBack={() => setDoor(null)} backLabel="Back" />
        ) : (
          <div style={{ paddingTop: '7dvh', textAlign: 'center' }}>
            <img src="/sb-sales-icon-180.png" alt="" width="88" height="88"
              style={{ borderRadius: 20, border: '1px solid #E2DCCE', marginBottom: 16 }} />
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.14em', color: '#6B6456' }}>
              STONEBOOKS <span style={{ color: '#9A7209' }}>SALES</span>
            </div>
            <div className="fl-serif" style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 52, fontWeight: 600, color: '#16150F', margin: '16px 0 12px', lineHeight: 1.1 }}>
              Welcome.
            </div>
            <div style={{ fontSize: 18, color: '#55503F', lineHeight: 1.6, maxWidth: 520, margin: '0 auto 38px' }}>
              Since 1919, families have trusted us with their memorials.
              How can we help you today?
            </div>
            <div className="fi-kiosk-doors">
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
    </div>
  )
}

// SALES-4: the kiosk is an IPAD app — undo the phone shell's narrow column
// (fl-body caps + 92px tab-bar padding) and let the big screen breathe.
// Doors go 3-across in landscape, stack in portrait.
const KIOSK_CSS = `
  .sk-ipad .fl-body { max-width: 1080px; margin: 0 auto; width: 100%; padding: 28px 34px 60px; font-size: 16px; }
  .sk-ipad .fl-input { font-size: 16.5px; padding: 13px 15px; }
  .sk-ipad .fl-row { min-height: 60px; }
  .fi-kiosk-doors { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; max-width: 1000px; margin: 0 auto; }
  .fi-kiosk-door { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 6px; text-align: left; background: #fff; border: 1.5px solid #E2DCCE; border-radius: 20px; padding: 28px 28px; cursor: pointer; font-family: inherit; min-height: 148px; }
  .fi-kiosk-door:active { background: #FBFAF6; border-color: #9A7209; }
  .fi-kiosk-door .nm { font-family: Fraunces, Georgia, serif; font-size: 26px; font-weight: 600; color: #16150F; line-height: 1.15; }
  .fi-kiosk-door .ds { font-size: 15px; color: #8A7F6C; line-height: 1.45; }
  @media (max-width: 700px) { .sk-ipad .fl-body { padding: 16px 16px 50px; } }
`
