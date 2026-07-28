const CACHE = 'kb-v7';
const URLS = [
  './',
  'index.html',
  'app.css?v=7',
  'app.js?v=7',
  'nav-tree.json',
  'search-index.json',
  'site-meta.json',
  'manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(URLS.map(url => new Request(url, { cache: 'reload' }))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('./');
      if (shell) return shell;
    }
    throw error;
  }
}
