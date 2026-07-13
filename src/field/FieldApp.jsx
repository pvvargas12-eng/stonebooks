// =============================================================================
// FieldApp.jsx — STONEBOOKS FIELD · the phone-first crew surface (/field)
// =============================================================================
// Own route, own components, staff auth. Shares the Supabase client + the
// stonebooksData helpers with the desktop app — and NOTHING else. No desktop
// file is imported for layout; no desktop surface changes because of /field.
//
// Screens: Installs (today's stops) · Production (advance the ladder, with
// UNDO) · Orders (search → job detail: approved layout, sizes, mark-the-spot)
// · Inventory (add / receive / undo). Detail + Complete ride on top.
// =============================================================================
import { useState, useEffect, useCallback } from 'react'
import { getSession, onAuthStateChange, signInWithPassword, signOut } from '../lib/auth'
import { getMyPartnerContext } from '../lib/vendorsData'
import { useUndoToast, FIELD_CSS } from './fieldUndo'
import UndoToast from './UndoToast'
import InstallsScreen from './InstallsScreen'
import ProductionScreen from './ProductionScreen'
import OrdersScreen from './OrdersScreen'
import JobDetailScreen from './JobDetailScreen'
import CompleteScreen from './CompleteScreen'
import InventoryScreen from './InventoryScreen'

// ── Login (phone-styled, same staff accounts) ────────────────────────────────
function FieldLogin() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    const res = await signInWithPassword(email.trim(), pw)
    setBusy(false)
    if (!res.ok) setErr(res.error || 'Sign-in failed.')
    // success: the parent's onAuthStateChange flips the gate
  }
  return (
    <div className="fl-login">
      <div className="fl-login-brand">STONEBOOKS <em>FIELD</em></div>
      <div className="fl-login-sub">Shevchenko Monuments · crew sign-in</div>
      <form onSubmit={submit} className="fl-login-form">
        <input type="email" inputMode="email" autoComplete="username" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" autoComplete="current-password" placeholder="Password"
          value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="fl-login-err">{err}</div>}
        <button type="submit" disabled={busy || !email.trim() || !pw}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

const TABS = [
  { key: 'installs',   label: 'INSTALLS' },
  { key: 'production', label: 'PRODUCTION' },
  { key: 'orders',     label: 'ORDERS' },
  { key: 'inventory',  label: 'INVENTORY' },
]

const NAV_GLYPHS = {
  installs:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  production: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 21V10l8-6 8 6v11" /><path d="M9 21v-6h6v6" /></svg>,
  orders:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7" /></svg>,
  inventory:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>,
}

export default function FieldApp() {
  const [authed, setAuthed] = useState(undefined)   // undefined=loading
  const [staffOk, setStaffOk] = useState(undefined) // undefined=checking, true/false
  const [tab, setTab] = useState('installs')
  // Detail navigation: { view: 'detail'|'complete', jobId, orderId, from }
  const [drill, setDrill] = useState(null)
  const undo = useUndoToast()

  useEffect(() => {
    let cancelled = false
    getSession().then(s => { if (!cancelled) setAuthed(!!s) })
    const unsub = onAuthStateChange(u => setAuthed(!!u))
    return () => { cancelled = true; unsub() }
  }, [])

  // Staff-only: a partner-mapped user gets bounced to their own portal.
  useEffect(() => {
    if (!authed) { setStaffOk(undefined); return }
    let cancelled = false
    getMyPartnerContext()
      .then(ctx => { if (!cancelled) setStaffOk(ctx === null) })
      .catch(() => { if (!cancelled) setStaffOk(true) })   // fail open for staff
    return () => { cancelled = true }
  }, [authed])

  useEffect(() => {
    if (staffOk === false) window.location.replace('/trade')
  }, [staffOk])

  const openJob = useCallback((ids, from) => setDrill({ view: 'detail', ...ids, from: from || tab }), [tab])
  const openComplete = useCallback((ids) => setDrill(d => ({ ...(d || {}), ...ids, view: 'complete' })), [])
  const closeDrill = useCallback(() => setDrill(d => (d?.view === 'complete' ? { ...d, view: 'detail' } : null)), [])
  const goTab = (k) => { setDrill(null); setTab(k) }

  if (authed === undefined || (authed && staffOk === undefined)) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><div className="fl-loading">Loading…</div></div>
  }
  if (!authed) {
    return <div className="fl-shell"><style>{FIELD_CSS}</style><FieldLogin /></div>
  }
  if (staffOk === false) return null   // redirecting to /trade

  return (
    <div className="fl-shell">
      <style>{FIELD_CSS}</style>
      <header className="fl-head">
        <div className="fl-head-row">
          <div className="fl-brand">STONEBOOKS <em>FIELD</em></div>
          <button type="button" className="fl-signout" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>

      <main className="fl-body">
        {drill?.view === 'detail' && (
          <JobDetailScreen jobId={drill.jobId} orderId={drill.orderId}
            onBack={closeDrill} onComplete={openComplete} undo={undo} />
        )}
        {drill?.view === 'complete' && (
          <CompleteScreen jobId={drill.jobId} orderId={drill.orderId} onBack={closeDrill} />
        )}
        {!drill && tab === 'installs' && <InstallsScreen onOpenJob={openJob} />}
        {!drill && tab === 'production' && <ProductionScreen onOpenJob={openJob} undo={undo} />}
        {!drill && tab === 'orders' && <OrdersScreen onOpenJob={openJob} />}
        {!drill && tab === 'inventory' && <InventoryScreen undo={undo} />}
      </main>

      <UndoToast toast={undo.toast}
        onUndo={async () => { const u = undo.toast?.undo; undo.clear(); if (u) await u() }}
        onDismiss={undo.clear} />

      <nav className="fl-nav">
        {TABS.map(t => (
          <button key={t.key} type="button"
            className={(!drill && tab === t.key) || (drill && drill.from === t.key) ? 'on' : ''}
            onClick={() => goTab(t.key)}>
            <span className="fl-nav-glyph">{NAV_GLYPHS[t.key]}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
