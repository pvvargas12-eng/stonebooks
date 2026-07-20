// =============================================================================
// sw.js — Stonebooks Field service worker (FIELD-3 push slice)
// =============================================================================
// Push display + notification-click routing ONLY. There is deliberately no
// fetch handler and no caching here — the PWA stays network-first exactly as
// it is; this worker exists so installed phones can receive Web Push and a
// notification tap can land back inside /field.
//
// Payload contract (must match api/push/send.js):
//   { title, body, tag, deep_link, badge }
// where badge is that person's unread-notification count at send time.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data
  try { data = event.data ? event.data.json() : {} } catch { data = {} }

  const title = data.title || 'Stonebooks'
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { deepLink: data.deep_link || null },
    icon: '/sb-field-icon-180.png',
    badge: '/sb-field-icon-180.png',
  }

  // App-icon badge count — best effort, quietly unsupported on most platforms.
  if (typeof data.badge === 'number') {
    try { self.navigator.setAppBadge?.(data.badge) } catch { /* unsupported */ }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const deepLink = (event.notification.data && event.notification.data.deepLink) || null

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = wins.find((c) => c.url && c.url.includes('/field'))
    if (existing) {
      try { await existing.focus() } catch { /* ignore */ }
      // FieldApp listens for this message and routes the deep link itself.
      existing.postMessage({ deepLink })
      return
    }
    await self.clients.openWindow('/field')
  })())
})
