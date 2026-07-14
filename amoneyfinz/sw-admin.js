// Minimal service worker — no offline caching, just here so the browser
// treats this page as an installable app. Admin data should always be
// live/fresh, so we deliberately do NOT cache anything.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
