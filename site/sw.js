const CACHE = 'investment-v2-shell-7';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/dom.js',
  './js/format.js',
  './js/futu.js',
  './js/fx.js',
  './js/messages.js',
  './js/portfolio.js',
  './js/refresh.js',
  './js/render.js',
  './js/sw-client.js',
  './js/sync-health.js',
  './js/responses.js',
  './js/tabs.js',
  './js/team-plan.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('investment-v2-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(cacheFirst(request));
});
