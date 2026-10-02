const CACHE = 'home-reviews-shell-v3'
const BASE = new URL(self.registration.scope).pathname
const SHELL = [BASE, `${BASE}manifest.webmanifest`, `${BASE}favicon.svg`]
const ASSETS = [] // BUILD_ASSETS

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...SHELL,...ASSETS.map(asset=>`${BASE}${asset}`)])))
  // Taking control does not reload clients; no controllerchange reload handler.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => {
      const oldShells=keys.filter(key=>key.startsWith('home-reviews-shell-') && key!==CACHE)
      const remove=keys.filter(key=>key.startsWith('home-reviews-') && !key.startsWith('home-reviews-shell-'))
      // Keep one prior static bundle for already-open clients and lazy chunks.
      return Promise.all([...remove,...oldShells.slice(0,-1)].map(key=>caches.delete(key)))
    }),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  // Never cache Supabase/API/auth responses, avatars, or cross-origin requests.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  const navigation = event.request.mode === 'navigate'
  const asset = url.pathname.startsWith(`${BASE}assets/`) || SHELL.includes(url.pathname)
  if (!navigation && !asset) return
  const key = navigation ? BASE : event.request
  const fresh = () => fetch(event.request).then(async response => {
    if (response.ok) { const cache=await caches.open(CACHE); await cache.put(key,response.clone()) }
    return response
  })
  // A revision precaches its complete shell+chunks. Never mix a new HTML shell
  // with unavailable chunks while offline. A new worker installs the next revision.
  // Static assets may carry Vary: Origin (module fetch vs install precache).
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(key,{ignoreVary:true})).then(async cached=>
    cached || (!navigation && await caches.match(key,{ignoreVary:true})) || fresh()).catch(()=>new Response('',{status:503})))
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
