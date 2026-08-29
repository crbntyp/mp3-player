// Service Worker for plyr PWA
const CACHE_NAME = 'plyr-v14';

// App-shell paths are derived from the registration scope rather than
// hardcoded to /plyr/. vite.config.js deliberately builds with `base: './'`
// so the same bundle works at any mount path — a hardcoded list contradicted
// that, and because cache.addAll() is atomic, one 404 would have made the
// whole service worker fail to install with no visible symptom.
const SCOPE = new URL(self.registration.scope);

const ASSETS_TO_CACHE = [
  '',
  'index.html',
  'scripts/main.js',
  'styles/main.css',
  'data/tracks.json',
  'data/placeholders.json',
  'img/assets/fav.png',
  'img/assets/record.png',
].map((p) => new URL(p, SCOPE).pathname);

// Install - cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('PWA: Caching app shell');
      // Added individually so one missing asset degrades to "that file isn't
      // precached" instead of aborting the entire install.
      //
      // `cache: 'reload'` is what makes this correct: a plain cache.add() goes
      // through the HTTP cache, so a new worker version can precache the
      // previous deploy's files and be none the wiser. Bypassing it means the
      // precache always reflects what the server has right now.
      await Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache
            .add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn('PWA: skipped', url, err.message))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GETs. Cross-origin (Google Fonts) and non-GET
  // requests are left to the network — cache.put() rejects on both.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Don't cache audio or proxy responses — audio files are tens of MB and
  // the proxy streams partial (206) responses, which aren't cacheable.
  if (url.pathname.includes('/music/') || url.pathname.includes('proxy.php')) {
    return;
  }

  // 'no-cache' forces a revalidation rather than a blind HTTP-cache hit. The
  // server's ETag turns that into a 304 in the common case, so this costs a
  // round trip, not a re-download — and it stops the worker from caching a
  // stale copy the browser handed it without asking the server.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone).catch(() => { /* uncacheable */ });
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
