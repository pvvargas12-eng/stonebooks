// =============================================================================
// push.js — Web Push plumbing + the notifications feed (FIELD-3)
// =============================================================================
// Client half of the push pipeline. The server half (api/push/send.js) writes
// `notifications` rows and fires webpush against `push_subscriptions`; this
// module registers the service worker, subscribes a device, and reads/writes
// the notifications feed for the bell screen.
//
// Permission flow contract: Notification.requestPermission() is ALWAYS called
// by the UI synchronously inside the tap handler (PermissionSheet) — iOS
// drops the prompt otherwise. subscribePush() assumes permission is already
// 'granted' and only does the subscribe + upsert.
import { supabase } from './supabase'

export const VAPID_PUBLIC_KEY = 'BPubLEBA6tPlIKfyVIoh4hDjKQX9HTGcuhNXbojp7sLfkQbsUkQI7O4QS6-rld74fPjD_JV15-QRJhJBTYh5Q5w'

// applicationServerKey wants raw bytes, the VAPID key ships base64url.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Feature detection only — no UA sniffing beyond what push-on-iOS requires
// (iPadOS reports MacIntel, hence the maxTouchPoints check).
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
  (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)

const isStandalone = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
  } catch { return false }
}

// Register /sw.js. Safe no-op (resolves null) when service workers are
// unsupported or registration fails — callers treat null as "no push here".
export function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null)
  }
  return navigator.serviceWorker.register('/sw.js')
    .catch((e) => { console.warn('[push] sw register failed:', e?.message); return null })
}

// One state string for the whole permission story:
//   'unsupported'   — this browser can never push
//   'not-installed' — iOS Safari outside the installed PWA (push only works
//                     from the Home Screen app there)
//   'default' | 'granted' | 'denied' — Notification.permission passthrough
export function getPushState() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator)) return 'unsupported'
  // Order matters: iOS-in-browser lacks PushManager, but the honest answer
  // there is "install the app first", not "unsupported".
  if (isIOS() && !isStandalone()) return 'not-installed'
  if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported'
  return Notification.permission
}

// Subscribe THIS device and upsert the subscription row (endpoint is unique —
// re-subscribing or switching the picked person just re-stamps the same row).
// Caller must already hold permission 'granted'.
export async function subscribePush(who) {
  if (!who?.name) return { ok: false, error: 'No one is picked on this phone.' }
  try {
    const registered = await registerSW()
    if (!registered) return { ok: false, error: 'Notifications are not available on this phone.' }
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
    const json = sub.toJSON() || {}
    const keys = json.keys || {}
    const { error } = await supabase.from('push_subscriptions').upsert({
      employee_name: who.name,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh || '',
      auth: keys.auth || '',
      device_label: String(navigator.userAgent || '').slice(0, 140),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not turn notifications on.' }
  }
}

// Drop THIS device's subscription (row first, then the browser-side one).
export async function unsubscribePush(who) {
  if (!who?.name) return { ok: false, error: 'No one is picked on this phone.' }
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return { ok: true }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (!sub) return { ok: true }
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    if (error) return { ok: false, error: error.message }
    await sub.unsubscribe().catch(() => {})
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not turn notifications off.' }
  }
}

// App-icon badge from the client side (the SW handles the push-time badge).
export function setAppBadge(count) {
  try {
    if (typeof navigator === 'undefined' || !navigator.setAppBadge) return
    if (count > 0) navigator.setAppBadge(count)
    else if (navigator.clearAppBadge) navigator.clearAppBadge()
    else navigator.setAppBadge(0)
  } catch { /* unsupported */ }
}

// ── Notifications feed (the bell) ────────────────────────────────────────────

export async function loadUnreadCount(name) {
  if (!name) return 0
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('employee_name', name)
    .is('read_at', null)
  if (error) { console.warn('[push] loadUnreadCount:', error.message); return 0 }
  return count || 0
}

// Last 30 days, newest first, capped at a page of 50.
export async function listNotifications(name) {
  if (!name) return []
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('employee_name', name)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) { console.warn('[push] listNotifications:', error.message); return [] }
  return data || []
}

export async function markRead(id) {
  if (!id) return { ok: false, error: 'Missing notification id.' }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function markAllRead(name) {
  if (!name) return { ok: false, error: 'Missing name.' }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('employee_name', name)
    .is('read_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
