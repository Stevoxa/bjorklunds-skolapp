/* eslint-disable no-restricted-globals */
// Simple service worker for offline support on a static PWA.

// Cache-namnet följer appens version. index.html registrerar sig som "./sw.js?v=<APP_VERSION>",
// så en bumpad APP_VERSION ger både en ny SW-fil (byte-skillnad = install körs) och en ny cache.
// Fallback finns för det fall registreringen sker utan query-sträng.
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "v0";
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
      // "reload" förbi HTTP-cachen, annars kan en ny version precacha gamla filer.
      try {
        await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
      } catch {
        await cache.addAll(PRECACHE_URLS);
      }
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

// Talar om för öppna flikar att en nyare index.html nu ligger i cachen, så att
// appen kan erbjuda omladdning direkt istället för vid nästa start.
async function notifyClientsOfUpdate() {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "UPDATE_READY" });
  }
}

// Hämtar index.html från nätet, jämför med den cachade kopian och skriver över den.
// Returnerar om innehållet skilde sig. Anropas både vid navigering och när appen
// ber om en kontroll. Att göra det här inne i service workern är viktigt: ett
// fetch-anrop från sidan hade fångats av cache-first-grenen och bara gett cachen.
async function revalidateIndexHtml() {
  const cache = await caches.open(STATIC_CACHE);
  const fresh = await fetch("./index.html", { cache: "no-store" });
  if (!fresh.ok) throw new Error(`status ${fresh.status}`);

  const previous = await cache.match("./index.html");
  const [before, after] = await Promise.all([
    previous ? previous.clone().text() : Promise.resolve(null),
    fresh.clone().text(),
  ]);

  await cache.put("./index.html", fresh.clone());
  return { changed: before !== null && before !== after, response: fresh };
}

// Manuell kontroll från inställningarna.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "CHECK_UPDATE") return;

  event.waitUntil(
    (async () => {
      const client = event.source;
      try {
        const { changed } = await revalidateIndexHtml();
        if (changed) {
          await notifyClientsOfUpdate();
        } else if (client) {
          client.postMessage({ type: "UP_TO_DATE" });
        }
      } catch (e) {
        if (client) client.postMessage({ type: "UPDATE_CHECK_FAILED" });
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  // Only cache http(s); extensions and other schemes are not supported by Cache API
  if (!request.url.startsWith("http")) return;

  // Tredjepartsanrop (matsedelns proxy) ska INTE röras. Den gamla catch-all-grenen
  // nedan är cache-first, vilket gjorde att första proxysvaret cachades permanent:
  // matsedeln såg ut att fungera men var i själva verket fryst, och när cachen väl
  // roterades slutade den fungera helt. Låt dem gå rakt ut på nätet istället.
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: stale-while-revalidate for index.html.
  // Return cached fast, but update cache in background so new versions arrive.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match("./index.html");
        const fetchAndUpdate = (async () => {
          try {
            // Ändras bara index.html installeras ingen ny service worker, så
            // jämförelsen här är enda sättet att upptäcka en ny version - annars
            // märker användaren den först vid nästa start.
            const { changed, response } = await revalidateIndexHtml();
            if (changed) await notifyClientsOfUpdate();
            return response;
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

