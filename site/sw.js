const CACHE = 'investment-v2-shell-1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/dom.js',
  './js/format.js',
  './js/market.js',
  './js/messages.js',
  './js/portfolio.js',
  './js/render.js',
  './js/scenario.js',
  './js/search.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('investment-v2-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/data/market-cache.json') || url.pathname.endsWith('/data/symbols.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
