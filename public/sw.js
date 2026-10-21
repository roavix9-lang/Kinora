// Kinora offline support: caches the app itself so it opens without internet. Library files the
// user downloaded live in the 'kinora-assets-v1' cache (written by the app); tile pictures and
// the catalog are cached as they are fetched.
const APP = 'kinora-app-v1';
const ASSETS = 'kinora-assets-v1';
const RUNTIME = 'kinora-runtime-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, ASSETS, RUNTIME].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req) || (req.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).href) : undefined);
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function cacheFirst(req, cacheName) {
  const hit = (await caches.match(req));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Pages: fresh when online, cached when not. Hashed build files never change: cache first.
    if (req.mode === 'navigate') e.respondWith(networkFirst(req, APP));
    else e.respondWith(cacheFirst(req, APP));
    return;
  }
  if (url.pathname.startsWith('/a/')) { e.respondWith(cacheFirst(req, RUNTIME)); return; }
  if (url.pathname.startsWith('/catalog')) { e.respondWith(networkFirst(req, RUNTIME)); return; }
});
