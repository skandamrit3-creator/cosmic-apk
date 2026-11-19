const CACHE_NAME = "cosmic-feature-overrides-v1";
const PREFIX = "/__cosmic_feature_overrides__/";
self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("cosmic-feature-overrides-") && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !/^\/(?:js|css)\//.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const override = await cache.match(self.location.origin + PREFIX + url.pathname.replace(/^\//, ""));
    return override || fetch(request);
  })());
});
