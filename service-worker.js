// ══════════════════════════════════════════════════════════════════
// Moneyfinz Service Worker
//
// GOAL: never let a stale, cached copy of index.html (or the app's
// core JS logic) get served to a returning user. A stale copy is
// exactly what was causing users with an ACTIVE subscription to see
// the paywall again after clearing cookies, and — worse — losing
// their transactions/budgets, because the browser kept running old
// broken app code instead of the fixed version sitting on the server.
//
// STRATEGY:
//  - HTML (the app shell, i.e. index.html / Admin.html): NETWORK-FIRST.
//    Always try the network for the latest code. Only fall back to a
//    cached copy if the device is genuinely offline. This guarantees
//    that as soon as you deploy a fix, every user gets it on their
//    very next load with network access — no manual cache-clearing,
//    no waiting for an old cache to expire.
//  - Static assets (icons, manifest, images): CACHE-FIRST, since those
//    rarely change and don't affect app logic/data safety.
//  - Every deploy that changes CACHE_VERSION automatically deletes all
//    old caches on activation, and the new worker takes control of
//    already-open tabs immediately (skipWaiting + clients.claim) —
//    instead of silently waiting in the background for every tab to
//    be closed and reopened first.
// ══════════════════════════════════════════════════════════════════

// Bump this string on every deploy that changes app code. It is the
// ONLY thing that forces old caches to be thrown away.
const CACHE_VERSION = 'moneyfinz-v2';

const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Only truly static, rarely-changing files belong here.
// Do NOT put index.html / Admin.html in this list — they must always
// go through the network-first path above so app logic can never go
// stale on a user's device.
const STATIC_ASSETS = [
  'app-logo.png',
  'payment-qr.png',
  'icon.svg',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  // Take over immediately after install instead of waiting for all
  // tabs of the old worker to close — that old "wait for every tab to
  // close" default is exactly how a stale worker can keep controlling
  // a browser for days.
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Best-effort: don't fail install if one asset 404s.
      Promise.all(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => {}))
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache that isn't part of the current version —
      // this is what guarantees old, possibly-broken cached app code
      // never lingers around after a new deploy.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
      // Start controlling already-open tabs right away, without
      // requiring a manual refresh.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isHTMLRequest =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isSameOrigin && isHTMLRequest) {
    // NETWORK-FIRST for the app shell (index.html / Admin.html).
    // This is the fix: app logic is always fetched fresh when online,
    // so a code fix on the server reaches users immediately instead
    // of being masked by an old cached page.
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          return networkResponse;
        })
        .catch(() =>
          // Offline fallback only — never preferred over the network.
          caches.match(req).then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  if (isSameOrigin) {
    // CACHE-FIRST for static assets only (images, manifest, etc.).
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((networkResponse) => {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            return networkResponse;
          })
      )
    );
  }
});
