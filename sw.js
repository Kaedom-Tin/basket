/* Basket service worker — v1
   Strategy:
   - Precache the app shell (index.html, manifest, icons) on install
   - Network-first for index.html (always get latest app version when online,
     fall back to cache when offline)
   - Cache-first for icons/fonts (rarely change)
   - Firebase and Anthropic API calls always go to network (never cached)
*/

const CACHE_NAME = 'basket-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: precache the shell, activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old cache versions, take control of open pages
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept non-GET requests
  if (event.request.method !== 'GET') return;

  // API / auth / database traffic: always network, never intercepted
  const NEVER_CACHE = ['firebaseio.com', 'googleapis.com', 'firebaseapp.com', 'anthropic.com'];
  if (NEVER_CACHE.some((h) => url.hostname.includes(h))) return;

  // Cacheable cross-origin allowlist: fonts only. Other cross-origin passes through.
  const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
  const isSameOrigin = url.origin === self.location.origin;
  const isFont = FONT_HOSTS.some((h) => url.hostname === h);
  if (!isSameOrigin && !isFont) return;

  // Navigation requests (opening the app): network-first, cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else same-origin + fonts/gstatic: cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        // Cache successful same-origin and font responses
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      });
    })
  );
});
