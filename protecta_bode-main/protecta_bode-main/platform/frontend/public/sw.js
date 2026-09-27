/* Protecta Bode portal service worker.
   App-shell cache-first for same-origin static assets, network-only for /api,
   offline fallback to the SPA shell. Version the cache to ship updates. */
const CACHE = 'protecta-portal-v2'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.ico',
  '/protecta-bode-logo.svg', '/assets/key-visual-1080.webp', '/assets/key-visual-1080.jpg']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/kyc/api/')) return // live API data: never cached
  if (url.origin !== self.location.origin) return       // fonts/CDN: browser default

  event.respondWith((async () => {
    const hit = await caches.match(req)
    if (hit) return hit
    try {
      const res = await fetch(req)
      if (res.ok) {
        const copy = res.clone()
        const cache = await caches.open(CACHE)
        cache.put(req, copy)
      }
      return res
    } catch (err) {
      // Offline navigation: fall back to the app shell
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html')
        if (shell) return shell
      }
      throw err
    }
  })())
})
