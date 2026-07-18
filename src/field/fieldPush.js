// =============================================================================
// fieldPush.js — Web Push client plumbing for the /field phone app
// =============================================================================
// The phone subscribes AS A PERSON (the fieldIdentity name), not as an auth
// user — all phones share the staff sign-in, so push_subscriptions.person_name
// is what routes a task notification to the right pocket. Subscription rows
// are upserted on enable and refreshed on every launch (a phone that switches
// person re-keys its row); the server sender prunes dead endpoints.
//
// iOS reality check: Safari only exposes PushManager to an installed PWA
// (Add to Home Screen, iOS 16.4+), so an un-installed phone reads as
// 'needs-install' — the UI turns that into Add-to-Home-Screen instructions
// instead of a broken button.
// =============================================================================
import { supabase } from '../lib/supabase'

const DISMISS_KEY = 'sb_field_push_dismissed'

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  window.navigator.standalone === true

// 'supported' | 'needs-install' (iOS Safari tab — must Add to Home Screen) | 'unsupported'
export function pushCapability() {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIOS() && !isStandalone()) return 'needs-install'
  return hasApis ? 'supported' : 'unsupported'
}

// Resolved state for the UI: 'on' | 'off' | 'denied' | 'needs-install' | 'unsupported'
export async function getPushState() {
  const cap = pushCapability()
  if (cap !== 'supported') return { state: cap }
  if (Notification.permission === 'denied') return { state: 'denied' }
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (Notification.permission === 'granted' && sub) return { state: 'on', endpoint: sub.endpoint }
  } catch { /* fall through to off */ }
  return { state: 'off' }
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(s)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function fetchVapidKey() {
  const r = await fetch('/api/push/send?config=1')
  if (!r.ok) throw new Error('Push is not configured on the server yet.')
  const j = await r.json()
  if (!j.publicKey) throw new Error('Push is not configured on the server yet.')
  return j.publicKey
}

async function upsertSubscription(sub, personName) {
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    person_name: personName,
    endpoint: sub.endpoint,
    keys: { p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth },
    user_agent: String(navigator.userAgent || '').slice(0, 300),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
}

// Must run inside a user gesture (the permission prompt requires it).
export async function enablePush(who) {
  const cap = pushCapability()
  if (cap !== 'supported') return { ok: false, error: cap }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, error: perm === 'denied' ? 'denied' : 'dismissed' }
    // First-ever enable: subscribe() needs the worker ACTIVE, not just
    // registered — .ready settles once activation lands (instant thereafter).
    await navigator.serviceWorker.ready
    const key = await fetchVapidKey()
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(key),
    })
    await upsertSubscription(sub, who.name)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Could not turn on notifications.' }
  }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'Could not turn off notifications.' }
  }
}

// Every launch with a resolved identity: clear the home-screen badge (they're
// looking at the app now) and, when already granted, refresh the subscription
// row — keeps last_seen fresh and re-points the row when the phone switched
// person. Silent on every failure; this must never block the app.
export async function syncPushOnLaunch(who) {
  try { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {}) } catch { /* ignore */ }
  if (pushCapability() !== 'supported') return
  if (Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await upsertSubscription(sub, who.name)
  } catch { /* silent — cron and the next launch cover it */ }
}

export const isPushCardDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}
export const dismissPushCard = () => {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
}
