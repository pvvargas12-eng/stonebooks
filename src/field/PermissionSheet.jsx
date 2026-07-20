// =============================================================================
// PermissionSheet — the "turn on notifications" ask (FIELD-3 push slice)
// =============================================================================
// Bottom sheet shown before the browser's own permission prompt: a mock push
// preview + role-tuned pitch, then ONE tap that synchronously calls
// Notification.requestPermission() (iOS drops the prompt if the call isn't in
// the same gesture). granted -> subscribePush(who) -> "You're set." and
// auto-close; denied -> the iOS Settings walk. Dismissals snooze the ask for
// 7 days via localStorage (sb_field_push_snooze).
import { useState, useEffect } from 'react'
import { subscribePush, getPushState } from '../lib/push'

const SNOOZE_KEY = 'sb_field_push_snooze'
const SNOOZE_DAYS = 7

// Should the shell offer this sheet right now? Only when the ask could still
// go somewhere: permission untouched, running as the installed app, and not
// dismissed within the last 7 days. Called from effects/handlers only.
// eslint-disable-next-line react-refresh/only-export-components -- shell helper lives with the sheet (DesignPacket precedent)
export function shouldOfferPush(who) {
  if (!who?.name) return false
  if (typeof window === 'undefined') return false
  if (getPushState() !== 'default') return false
  try {
    if (!window.matchMedia('(display-mode: standalone)').matches &&
      window.navigator.standalone !== true) return false
  } catch { return false }
  try {
    const snooze = window.localStorage.getItem(SNOOZE_KEY)
    if (snooze && (Date.now() - new Date(snooze).getTime()) < SNOOZE_DAYS * 86400000) return false
  } catch { /* ignore */ }
  return true
}

const CREW_BULLETS = [
  'New tasks land on your lock screen the moment they are sent',
  'Replies come straight to you — no checking the app all day',
  'One tap opens the exact task or job',
]
const OWNER_BULLETS = [
  'Every payment, the second it lands',
  'Proof signatures and change requests, same minute',
  'Task replies from the crew without asking',
]

export default function PermissionSheet({ who, onClose, onGranted }) {
  const isOwner = !!who?.isOwner
  const [phase, setPhase] = useState('ask')   // ask | granted | denied
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Success screen lingers 1.5s, then reports up and closes itself.
  useEffect(() => {
    if (phase !== 'granted') return undefined
    const t = setTimeout(() => {
      if (onGranted) onGranted()
      onClose()
    }, 1500)
    return () => clearTimeout(t)
  }, [phase, onGranted, onClose])

  const dismiss = () => {
    if (busy) return
    try { window.localStorage.setItem(SNOOZE_KEY, new Date().toISOString()) } catch { /* ignore */ }
    onClose()
  }

  const turnOn = () => {
    if (busy) return
    setErr(null)
    setBusy(true)
    // MUST fire synchronously inside the tap — everything else chains off the
    // returned promise.
    let req
    try { req = Notification.requestPermission() } catch { req = Promise.resolve('denied') }
    Promise.resolve(req).then(async (perm) => {
      if (perm === 'granted') {
        const res = await subscribePush(who)
        setBusy(false)
        if (res.ok) setPhase('granted')
        else setErr(res.error || 'Could not turn notifications on — try again.')
        return
      }
      setBusy(false)
      if (perm === 'denied') setPhase('denied')
      else dismiss()   // prompt dismissed without an answer — treat as "not now"
    })
  }

  const scrimClose = phase === 'ask' ? dismiss : onClose

  return (
    <>
      <div className="fl-sheet-scrim" onClick={scrimClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />

        {phase === 'granted' && (
          <div style={{ padding: '26px 4px 20px', textAlign: 'center' }}>
            <div className="fl-serif" style={{ fontSize: 28, fontWeight: 600, color: '#16150F' }}>
              You&#8217;re set.
            </div>
            <div style={{ fontSize: 13.5, color: '#6B6456', marginTop: 8 }}>
              This phone will hear about it the moment something needs you.
            </div>
          </div>
        )}

        {phase === 'denied' && (
          <>
            <div className="fl-sheet-title" style={{ marginBottom: 8 }}>Notifications are blocked</div>
            <div style={{ fontSize: 14, color: '#55503F', lineHeight: 1.55 }}>
              This phone said no to notifications, so the app cannot ask again itself.
              To turn them on:
            </div>
            <div style={{ background: '#F5F3EE', borderRadius: 12, padding: '12px 14px', margin: '12px 0 16px', fontSize: 13.5, color: '#16150F', fontWeight: 600, lineHeight: 1.75 }}>
              <div>1. Open Settings on this iPhone</div>
              <div>2. Scroll down and tap Stonebooks</div>
              <div>3. Tap Notifications, switch Allow Notifications on</div>
            </div>
            <button type="button" className="fl-btn-ghost" onClick={onClose}>Done</button>
          </>
        )}

        {phase === 'ask' && (
          <>
            {/* Mock push preview — what one of these actually looks like */}
            <div style={{ background: '#EEEAE0', borderRadius: 14, padding: '12px 13px', display: 'flex', gap: 11, alignItems: 'flex-start', margin: '2px 0 16px' }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: '#0F1419', color: '#E8E2D4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0, letterSpacing: '0.05em' }}>
                S<span style={{ color: '#C9A468' }}>B</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: '#16150F' }}>
                    {isOwner ? 'Payment received' : 'New task from Paul'}
                  </span>
                  <span style={{ fontSize: 11, color: '#8A7F6C', flexShrink: 0 }}>now</span>
                </div>
                <div style={{ fontSize: 13, color: '#55503F', marginTop: 2, lineHeight: 1.4 }}>
                  {isOwner
                    ? '$2,500.00 check — KOWALSKI E-26-0142.'
                    : 'Check the base at St. Gertrude before Friday.'}
                </div>
              </div>
            </div>

            <div className="fl-sheet-title" style={{ marginBottom: 10 }}>
              {isOwner ? 'Know the moment money moves' : 'Know the moment Paul needs you'}
            </div>

            {(isOwner ? OWNER_BULLETS : CREW_BULLETS).map(line => (
              <div key={line} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0' }}>
                <span style={{ width: 8, height: 8, background: '#9A7209', borderRadius: 2, flexShrink: 0, marginTop: 5 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#16150F', lineHeight: 1.45 }}>{line}</span>
              </div>
            ))}

            {err && (
              <div style={{ fontSize: 12.5, color: '#B3261E', fontWeight: 600, marginTop: 8 }}>{err}</div>
            )}

            <button type="button" className="fl-btn-dark" style={{ minHeight: 56, marginTop: 16 }}
              onClick={turnOn} disabled={busy}>
              {busy ? 'Turning on…' : 'Turn on notifications'}
            </button>
            <button type="button" onClick={dismiss} disabled={busy}
              style={{ display: 'block', width: '100%', background: 'none', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: '#6B6456', minHeight: 44, cursor: 'pointer', marginTop: 6 }}>
              Not now
            </button>
          </>
        )}
      </div>
    </>
  )
}
