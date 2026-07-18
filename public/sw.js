/* =============================================================================
 * sw.js — Stonebooks Field push service worker
 * =============================================================================
 * PUSH ONLY. There is deliberately NO fetch handler — this worker must never
 * cache or intercept the app (a stale-cache SPA is worse than no SW). It shows
 * notifications, routes taps into /field, keeps the iOS app badge honest, and
 * best-effort survives a browser-initiated subscription rotation.
 * ========================================================================== */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch { p = { body: event.data ? event.data.text() : '' } }
  const title = p.title || 'Stonebooks Field'
  const jobs = [self.registration.showNotification(title, {
    body: p.body || '',
    icon: '/sb-field-icon-180.png',
    badge: '/sb-field-icon-180.png',
    tag: p.tag || undefined,
    data: { url: p.url || '/field' },
  })]
  // Sender attaches the recipient's live due-count; keep the home-screen badge
  // in sync (iOS 16.4+ / Chromium). Guarded — absent API is fine.
  if (typeof p.badgeCount === 'number' && 'setAppBadge' in navigator) {
    jobs.push(p.badgeCount > 0 ? navigator.setAppBadge(p.badgeCount) : navigator.clearAppBadge())
  }
  event.waitUntil(Promise.all(jobs).catch(() => {}))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/field'
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url && w.url.includes('/field')) {
        try { await w.focus() } catch { /* focus can be refused; message anyway */ }
        // The app listens for this and deep-links in place (no reload).
        try { w.postMessage({ type: 'sb-field-open', url }) } catch { /* ignore */ }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})

// The push service can rotate a subscription out from under us. Re-subscribe
// with the current VAPID key and tell the server to re-key the old row by its
// endpoint. Best-effort — the app also re-upserts its subscription on every
// launch, which covers anything missed here.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const cfg = await fetch('/api/push/send?config=1').then(r => (r.ok ? r.json() : null))
      if (!cfg || !cfg.publicKey) return
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(cfg.publicKey),
      })
      const oldEndpoint = (event.oldSubscription && event.oldSubscription.endpoint) || null
      await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resubscribe: { oldEndpoint, subscription: sub.toJSON() } }),
      })
    } catch { /* next app open re-syncs the row */ }
  })())
})
