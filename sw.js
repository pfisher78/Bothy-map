/* Bothy Map service worker — v1 */
const SHELL_CACHE = 'bothy-shell-v1';
const TILE_CACHE = 'bothy-tiles-v1';
const TILE_LIMIT = 3000;               // max cached tiles (~40–60 MB)
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![SHELL_CACHE, TILE_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isTile(url) {
  return url.hostname.endsWith('tile.opentopomap.org') || url.hostname.endsWith('tile.openstreetmap.org');
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles: cache-first, then network, store a copy
  if (isTile(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          if (res.ok) { cache.put(e.request, res.clone()); trimTiles(cache); }
          return res;
        } catch {
          return new Response('', { status: 503 }); // offline, tile not cached
        }
      })
    );
    return;
  }

  // App shell (same-origin) & fonts/leaflet CDN: cache-first with network fallback
  e.respondWith(
    caches.match(e.request, { ignoreSearch: url.origin === location.origin }).then(hit =>
      hit || fetch(e.request).then(res => {
        if (res.ok && (url.origin === location.origin || /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host))) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > TILE_LIMIT) {
      // delete oldest entries (insertion order)
      for (const k of keys.slice(0, keys.length - TILE_LIMIT)) await cache.delete(k);
    }
  } finally { trimming = false; }
}
