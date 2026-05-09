const SHELL_CACHE = 'puzzle-shell-v1';
const IMAGE_CACHE = 'puzzle-images-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/app.css',
  './css/puzzle.css',
  './js/storage.js',
  './js/puzzle-engine.js',
  './js/puzzle-render.js',
  './js/home.js',
  './js/app.js',
  './data/puzzles.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== IMAGE_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Cache-first for cross-origin puzzle images
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Cache-first for same-origin shell assets
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});
