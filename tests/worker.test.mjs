// Säkerhetsspärrarna i matproxyn. Adressen ligger i ett publikt repo, så workern
// får varken fungera som öppen proxy eller gå att läsa från någon annans sida.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/skolmat-proxy.js";

const APP = "https://stevoxa.github.io";
const BASE = "https://skolmat-proxy.example.workers.dev";
const RSS = "https://skolmaten.se/api/4/rss/week/skola?locale=sv";

let upstreamUrl = null;
const realFetch = globalThis.fetch;
test.before(() => {
    globalThis.fetch = async (u) => {
        upstreamUrl = String(u);
        return new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } });
    };
});
test.after(() => { globalThis.fetch = realFetch; });
test.beforeEach(() => { upstreamUrl = null; });

const call = (target, init = {}) => {
    const url = target === undefined ? `${BASE}/` : `${BASE}/?url=${encodeURIComponent(target)}`;
    return worker.fetch(new Request(url, { headers: { Origin: APP }, ...init }));
};

test("hämtar från skolmaten.se och svarar appens origin", async () => {
    const r = await call(RSS);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), APP);
    assert.equal(upstreamUrl, RSS);
});

test("vägrar andra mål än skolmaten.se", async () => {
    const r = await call("https://example.com/");
    assert.equal(r.status, 403);
    assert.equal(upstreamUrl, null, "inget uppströmsanrop görs");
});

test("vägrar http och domäner som bara liknar skolmaten.se", async () => {
    assert.equal((await call("http://skolmaten.se/x")).status, 403);
    assert.equal((await call("https://skolmaten.se.example.com/x")).status, 403);
    assert.equal((await call("https://falskskolmaten.se/x")).status, 403);
});

test("främmande origin får inte sitt eget origin tillbaka", async () => {
    const r = await worker.fetch(new Request(`${BASE}/?url=${encodeURIComponent(RSS)}`, {
        headers: { Origin: "https://elak.example.com" }
    }));
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), APP, "webbläsaren blockerar då svaret");
});

test("preflight, saknad url och fel metod", async () => {
    assert.equal((await call(RSS, { method: "OPTIONS" })).status, 204);
    assert.equal((await call(undefined)).status, 400);
    assert.equal((await call(RSS, { method: "POST" })).status, 405);
});
