/* eslint-disable no-restricted-globals */
// Simple service worker for offline support on a static PWA.

const CACHE_VERSION = "v4";
const STATIC_CACHE = `bjorklunds-static-${CACHE_VERSION}`;

// Keep this list tight; JSON is also cached but can be refreshed.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./image/icon-192x192.png",
  "./image/icon-512x512.png",
  "./schema_elev_a.json",
  "./schema_elev_b.json",
  "./lov_helg.json",
  "./termin.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("bjorklunds-static-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isJsonRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.toLowerCase().endsWith(".json");
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Only cache http(s); extensions and other schemes are not supported by Cache API
  if (!request.url.startsWith("http")) return;

  // Navigations: stale-while-revalidate for index.html.
  // Return cached fast, but update cache in background so new versions arrive.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match("./index.html");
        const fetchAndUpdate = (async () => {
          try {
            const fresh = await fetch("./index.html", { cache: "no-store" });
            if (fresh.ok) {
              await cache.put("./index.html", fresh.clone());
            }
            return fresh;
          } catch {
            return null;
          }
        })();

        if (cached) {
          event.waitUntil(fetchAndUpdate);
          return cached;
        }

        const fresh = await fetchAndUpdate;
        return fresh || Response.error();
      })()
    );
    return;
  }

  // Network-first for local JSON (schemas/terms/holidays) so updates appear quickly.
  if (isJsonRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        try {
          const fresh = await fetch(request, { cache: "no-store" });
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match(request);
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Cache-first for everything else (static assets).
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return Response.error();
      }
    })()
  );
});

