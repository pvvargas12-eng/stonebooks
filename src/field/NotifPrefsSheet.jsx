// =============================================================================
// NotifPrefsSheet — what THIS phone gets pushed (FIELD-6)
// =============================================================================
// Per-device toggles stored in push_subscriptions.prefs; the sender skips a
// kind a device muted. The in-app bell always keeps everything — these govern
// lock-screen pushes only. Role-aware: crew see task kinds + digest; owners
// also see money/proof kinds. Each flip saves immediately (optimistic,
// reverts on failure) — no confirm, matching the app's write grammar.
import { useState, useEffect } from 'react'
import { getThisDeviceSubscription, saveThisDevicePrefs, getPushState } from './fieldPush'

const CREW_KINDS = [
  { key: 'task_assigned', label: 'New tasks',      sub: 'A task lands on you or your department' },
  { key: 'task_reply',    label: 'Replies',        sub: 'Someone answers on your task' },
  { key: 'digest',        label: 'Morning digest', sub: 'After 7am: what is due today' },
]
const OWNER_KINDS = [
  { key: 'payment',  label: 'Payments',       sub: 'Money lands on any order' },
  { key: 'proofs',   label: 'Proof activity', sub: 'A family signs or asks for changes' },
]

export default function NotifPrefsSheet({ who, onClose, onAskPush }) {
  const isOwner = !!who?.isOwner
  const kinds = isOwner ? [...CREW_KINDS, ...OWNER_KINDS] : CREW_KINDS
  const [row, setRow] = useState(undefined)   // undefined loading | null no sub | row
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const state = await getPushState().catch(() => ({ state: 'off' }))
      if (state.state !== 'on') { if (!cancelled) setRow(null); return }
      const r = await getThisDeviceSubscription()
      if (!cancelled) setRow(r)
    })()
    return () => { cancelled = true }
  }, [])

  const isOn = (key) => !(row?.prefs && row.prefs[key] === false)
  const flip = async (key) => {
    if (!row) return
    const prev = row.prefs || {}
    const next = { ...prev, [key]: !isOn(key) ? true : false }
    if (next[key] === true) delete next[key]      // absent = on; keep rows tidy
    setErr(null)
    setRow(r => ({ ...r, prefs: next }))
    const res = await saveThisDevicePrefs(row.endpoint, next)
    if (!res.ok) {
      setRow(r => ({ ...r, prefs: prev }))
      setErr(res.error || 'Could not save — try again.')
    }
  }

  return (
    <>
      <div className="fl-sheet-scrim" onClick={onClose} />
      <div className="fl-sheet">
        <div className="fl-sheet-grab" />
        <div className="fl-sheet-title">Notifications on this phone</div>

        {row === undefined && <div className="fl-empty">Checking this phone…</div>}

        {row === null && (
          <>
            <div style={{ fontSize: 14, color: '#55503F', lineHeight: 1.55, marginBottom: 14 }}>
              Notifications are not on for this phone yet — turn them on first,
              then choose what reaches your lock screen.
            </div>
            {onAskPush && (
              <button type="button" className="fl-btn-dark" onClick={() => { onClose(); onAskPush() }}>
                Turn on notifications
              </button>
            )}
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
          </>
        )}

        {row && (
          <>
            {kinds.map(k => (
              <button key={k.key} type="button" className="fl-rowline" style={{ minHeight: 54 }}
                onClick={() => flip(k.key)}>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#16150F' }}>{k.label}</div>
                  <div style={{ fontSize: 12, color: '#8A7F6C', marginTop: 1 }}>{k.sub}</div>
                </div>
                <span className={`fl-toggle${isOn(k.key) ? ' on' : ''}`} aria-hidden="true"><i /></span>
              </button>
            ))}
            <div style={{ fontSize: 11.5, color: '#8A7F6C', margin: '10px 2px 2px', lineHeight: 1.5 }}>
              These control lock-screen pushes on THIS phone only. The bell in the
              app always keeps everything.
            </div>
            {err && <div className="fl-login-err" style={{ marginTop: 8 }}>{err}</div>}
            <button type="button" className="fl-btn-ghost" style={{ marginTop: 14 }} onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </>
  )
}
