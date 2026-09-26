const CACHE = 'home-reviews-v1'
const BASE = new URL(self.registration.scope).pathname
const SHELL = [BASE, `${BASE}manifest.webmanifest`, `${BASE}favicon.svg`]
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    return response
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(BASE))))
})
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'HOME Reviews', body: 'Une nouvelle alerte vous attend.' }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: `${BASE}favicon.svg`, data: data.url || `${BASE}#/notifications` }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data || '/notifications'))
})
