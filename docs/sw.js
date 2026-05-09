const SHELL_VERSION = '20260509-7';
const SHELL_CACHE = 'puzzle-shell-' + SHELL_VERSION;
const IMAGE_CACHE = 'puzzle-images-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css?v=20260509-5',
  './css/app.css?v=20260509-7',
  './css/puzzle.css?v=20260509-5',
  './js/storage.js?v=20260509-6',
  './js/puzzle-engine.js?v=20260509-6',
  './js/puzzle-render.js?v=20260509-7',
  './js/home.js?v=20260509-6',
  './js/app.js?v=20260509-6',
  './data/puzzles.json',
  './images/icons/icon.svg',
];

const SHELL_PATHS = new Set(SHELL_ASSETS.map(asset => new URL(asset, self.location.href).pathname));

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

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

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache-first for cross-origin puzzle images
  if (url.origin !== self.location.origin) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
