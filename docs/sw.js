const CACHE_NAME = 'puzzles-v2';

// All assets to pre-cache on install
const PRE_CACHE = [
  './',
  './index.html',
  './home.html',
  './puzzle.html',
  './manifest.json',
  './css/variables.css',
  './css/app.css',
  './css/auth.css',
  './css/puzzle.css',
  './js/storage.js',
  './js/auth.js',
  './js/home.js',
  './js/puzzle-engine.js',
  './js/puzzle-render.js',
  './js/app.js',
  './data/puzzles.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first, falling back to network
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin resources
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'error') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
