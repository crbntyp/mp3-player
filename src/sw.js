// Service Worker for plyr PWA
const CACHE_NAME = 'plyr-v1';
const ASSETS_TO_CACHE = [
  '/plyr/',
  '/plyr/index.html',
  '/plyr/styles/main.css',
  '/plyr/scripts/main.js',
  '/plyr/scripts/drive.js',
  '/plyr/scripts/visualizer.js',
  '/plyr/data/tracks.json',
  '/plyr/data/placeholders.json',
  '/plyr/img/assets/fav.png',
  '/plyr/img/assets/record.png'
];

// Install - cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('PWA: Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
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

  // Don't cache audio files or proxy requests (too large)
  if (url.pathname.includes('/music/') ||
      url.pathname.includes('proxy.php') ||
      url.pathname.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache
        return caches.match(event.request);
      })
  );
});
