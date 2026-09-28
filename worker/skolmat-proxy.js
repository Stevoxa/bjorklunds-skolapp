/**
 * Cloudflare Worker: minimal CORS-proxy för skolmaten.se
 *
 * Skolmaten skickar Access-Control-Allow-Origin för sitt eget origin, så
 * webbläsaren kan inte hämta flödet direkt från appen. Den här workern gör
 * hämtningen på serversidan, där CORS inte finns, och svarar appen med rätt
 * headers.
 *
 * Adressen ligger i ett publikt repo, därför är workern låst i två led:
 *   1. Den hämtar BARA från skolmaten.se.
 *   2. Den svarar BARA med CORS-headers till origin i ALLOWED_ORIGINS.
 * Någon annan kan alltså varken använda den som öppen proxy mot valfri sajt
 * eller läsa svaret från en egen sida.
 *
 * Deploy: se README, avsnittet "Matsedeln".
 */

const ALLOWED_ORIGINS = [
  "https://stevoxa.github.io",
  "http://localhost:4173", // lokal utveckling
];

const ALLOWED_HOST = "skolmaten.se";

// Hur länge Cloudflare får återanvända ett svar. Matsedeln ändras högst en gång
// per vecka, så en kvart kostar inget och skonar både skolmaten och kvoten.
const CACHE_SECONDS = 900;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    Vary: "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET") {
      return new Response("Endast GET.", { status: 405, headers: cors });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) {
      return new Response('Saknar parametern "url".', { status: 400, headers: cors });
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return new Response("Ogiltig url.", { status: 400, headers: cors });
    }

    const hostOk = parsed.hostname === ALLOWED_HOST || parsed.hostname.endsWith(`.${ALLOWED_HOST}`);
    if (parsed.protocol !== "https:" || !hostOk) {
      return new Response(`Endast https://${ALLOWED_HOST} är tillåten.`, { status: 403, headers: cors });
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), {
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      });
    } catch (e) {
      return new Response(`Kunde inte nå ${ALLOWED_HOST}.`, { status: 502, headers: cors });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") || "application/xml; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    });
  },
};
