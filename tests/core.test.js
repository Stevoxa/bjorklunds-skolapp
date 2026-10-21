"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const core = loadCore();
const at = (iso) => new Date(`${iso}T12:00:00`);

// Kärnan körs i en egen vm-kontext, och arrayer därifrån har en annan Array-prototyp
// än testfilens. deepStrictEqual jämför prototyper och skulle då fallera på identiskt
// innehåll, så resultat förs över till den här kontexten innan de jämförs.
const plain = (v) => JSON.parse(JSON.stringify(v));

test("veckonummer, även kring nyår", () => {
    assert.equal(core.getWeek(at("2026-09-21")), 39);
    assert.equal(core.getWeek(at("2026-09-27")), 39, "söndag hör till samma vecka");
    assert.equal(core.getWeek(at("2026-09-28")), 40);
    // 2026 börjar på en torsdag och har därför 53 veckor
    assert.equal(core.getWeek(at("2026-12-28")), 53);
    assert.equal(core.getWeek(at("2027-01-01")), 53, "nyårsdagen 2027 tillhör vecka 53 av 2026");
    assert.equal(core.getWeek(at("2027-01-04")), 1);
    assert.equal(core.getWeek(at("2024-12-30")), 1, "vecka 1 kan börja i december");
});

test("veckostart är måndagen, även över årsskiftet", () => {
    assert.equal(core.getWeekStartStr(at("2026-09-27")), "2026-09-21");
    assert.equal(core.getWeekStartStr(at("2026-09-21")), "2026-09-21");
    assert.equal(core.getWeekStartStr(at("2027-01-01")), "2026-12-28");
});

test("veckan ur pubDate - det som avgör om en meny får visas", () => {
    const v40 = ["Mon, 28 Sep 2026 00:00:00 GMT", "Tue, 29 Sep 2026 00:00:00 GMT"];
    assert.equal(core.weekStartFromPubDates(v40), "2026-09-28");
    assert.equal(core.weekStartFromPubDates([...v40].reverse()), "2026-09-28", "ordningen spelar ingen roll");
    assert.equal(core.weekStartFromPubDates(["skräp", "", ...v40]), "2026-09-28", "ogiltiga datum hoppas över");
    assert.equal(core.weekStartFromPubDates([]), null);
    assert.equal(core.weekStartFromPubDates(undefined), null);
});

test("veckonummer i titeln godtas bara för innevarande vecka", () => {
    const now = at("2026-09-30");
    assert.equal(core.weekStartFromTitles(["Måndag - Vecka 40"], now), "2026-09-28");
    assert.equal(core.weekStartFromTitles(["Måndag - Vecka 39"], now), null, "förra veckans meny");
    assert.equal(core.weekStartFromTitles(["Måndag"], now), null);
});

test("helger hoppas över i rätt riktning", () => {
    const fram = core.skipWeekend(at("2026-09-26"), 1);
    assert.equal(core.getLocalDateStr(fram), "2026-09-28", "lördag framåt -> måndag");
    const bak = core.skipWeekend(at("2026-09-27"), -1);
    assert.equal(core.getLocalDateStr(bak), "2026-09-25", "söndag bakåt -> fredag");
    const vardag = core.skipWeekend(at("2026-09-30"), 1);
    assert.equal(core.getLocalDateStr(vardag), "2026-09-30", "vardag rörs inte");
});

test("tider och lektionsintervall", () => {
    assert.equal(core.parseTimeToMinutes("08.30"), 510);
    assert.equal(core.parseTimeToMinutes("8:05"), 485);
    assert.equal(core.parseTimeToMinutes("24.00"), null);
    assert.equal(core.parseTimeToMinutes("08.60"), null);
    assert.equal(core.parseTimeToMinutes("åtta"), null);
    assert.deepEqual(plain(core.parseLessonRange("08.30-09.25")), { start: 510, end: 565 });
    assert.deepEqual(plain(core.parseLessonRange(" 08.30 - 09.25 ")), { start: 510, end: 565 });
    assert.equal(core.parseLessonRange("08.30"), null);
});

test("lektioner sorteras på starttid, trasiga sist", () => {
    const sorted = core.getSortedLessons([
        { tid: "13.00-14.00", ämne: "C" },
        { tid: "trasig", ämne: "X" },
        { tid: "08.30-09.25", ämne: "A" },
        { tid: "10.00-11.00", ämne: "B" }
    ]);
    assert.deepEqual(plain(sorted.map((l) => l.ämne)), ["A", "B", "C", "X"]);
});

test("ämne och sal plockas ur ämnestexten", () => {
    assert.equal(core.getSubjectBase("Matematik (E22)"), "Matematik");
    assert.equal(core.getSubjectRoom("Matematik (E22)"), "E22");
    assert.equal(core.getSubjectRoom("Idrott och hälsa"), "");
    assert.equal(core.getSubjectBase(""), "Okänt ämne");
});

test("HTML escapas", () => {
    assert.equal(core.escapeHtml(`<b onclick="x">&'`), "&lt;b onclick=&quot;x&quot;&gt;&amp;&#039;");
});

test("migrering: gamla versionsnycklar flyttas, högsta versionen vinner", () => {
    const store = fakeStorage({
        bjorklundskolapp_store_v40: "gammal",
        bjorklundskolapp_store_v51: "nyast",
        bjorklundskolapp_theme: "dark"
    });
    const from = core.migrateStorageKey(store, "bjorklundskolapp_store", /^bjorklundskolapp_store_v\d+$/);
    assert.equal(from, "bjorklundskolapp_store_v51");
    assert.equal(store.getItem("bjorklundskolapp_store"), "nyast");
    assert.equal(store.getItem("bjorklundskolapp_store_v40"), null);
    assert.equal(store.getItem("bjorklundskolapp_store_v51"), null);
    assert.equal(store.getItem("bjorklundskolapp_theme"), "dark", "andra nycklar rörs inte");
});

test("migrering skriver aldrig över befintlig data", () => {
    const store = fakeStorage({ bjorklundskolapp_store: "aktuell", bjorklundskolapp_store_v51: "gammal" });
    const from = core.migrateStorageKey(store, "bjorklundskolapp_store", /^bjorklundskolapp_store_v\d+$/);
    assert.equal(from, null);
    assert.equal(store.getItem("bjorklundskolapp_store"), "aktuell");
    assert.equal(store.getItem("bjorklundskolapp_store_v51"), null, "men den gamla städas bort");
});

function fakeStorage(initial) {
    const map = new Map(Object.entries(initial));
    return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k)
    };
}
