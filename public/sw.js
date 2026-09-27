const CACHE = 'home-reviews-v2'
const BASE = new URL(self.registration.scope).pathname
const SHELL = [BASE, `${BASE}manifest.webmanifest`, `${BASE}favicon.svg`]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone()
    void caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    return response
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(BASE))))
})

self.addEventListener('push', (event) => {
  let data = { title: 'HOME Reviews', body: 'Une nouvelle alerte vous attend.', url: '#/notifications', tag: 'home-reviews' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    if (event.data?.text()) data.body = event.data.text()
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: `${BASE}favicon.svg`,
    badge: `${BASE}favicon.svg`,
    tag: data.tag,
    renotify: false,
    data: { url: data.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '#/notifications', self.registration.scope).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(targetUrl)
        return client.focus()
      }
    }
    return self.clients.openWindow(targetUrl)
  }))
})
