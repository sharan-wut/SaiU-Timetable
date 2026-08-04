const CACHE_NAME = 'timetable-v5';
const ASSETS = [
  'index.html',
  'style.css',
  'manifest.json',
  'js/config.js',
  'js/parser.js',
  'js/utils.js',
  'js/storage.js',
  'js/ui.js',
  'js/app.js',
  'icons/favicon.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

const SHEET_CACHE = 'timetable-sheet-v1';

// Local / dev hosts must NEVER be controlled by a service worker. A stale
// worker serves the cached app shell (cache-first), so edits made while
// developing with Live Server (or any local static server) never appear.
// A stale worker also serves old JS that may not know how to unregister
// itself, which permanently locks the browser onto old files.
const DEV_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
const isDevHost = DEV_HOSTS.includes(self.location.hostname);

// Install Service Worker
self.addEventListener('install', (event) => {
  if (isDevHost) {
    // On dev hosts the service worker destroys itself instead of caching.
    // Unregistering here also frees the origin from any older stale worker,
    // so Live Server reloads always show fresh files.
    self.registration.unregister();
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
  if (isDevHost) {
    // Remove any leftover caches on dev hosts.
    event.waitUntil(
      caches.keys().then((cacheNames) =>
        Promise.all(cacheNames.map((name) => caches.delete(name)))
      )
    );
    return;
  }
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== SHEET_CACHE) {
            return caches.delete(cache);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch Strategy:
//   - Navigation (HTML): network-first so updates/deploys are never hidden
//     behind a stale cached page.
//   - App shell assets: cache-first.
//   - Google Sheet CSV: network-first, fall back to last cached copy.
self.addEventListener('fetch', (event) => {
  if (isDevHost) return; // never intercept on dev hosts

  const url = event.request.url;

  if (url.includes('docs.google.com/spreadsheets') && url.includes('export')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(SHEET_CACHE).then((cache) => cache.put(event.request, cacheCopy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return networkResponse;
      });
      return fetchPromise;
    })
  );
});
