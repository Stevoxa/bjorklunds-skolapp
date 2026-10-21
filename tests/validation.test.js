"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadCore } = require("./load-core");

const core = loadCore();
const ROOT = path.join(__dirname, "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const plain = (v) => JSON.parse(JSON.stringify(v));

const lesson = (tid, ämne = "Matematik (A1)") => ({ tid, ämne });

function validBundle() {
    return {
        bundleVersion: 1,
        children: [{
            id: "elev_a",
            name: "Elev A",
            rss: "",
            schema: { schema: [{ dag: "Måndag", lektioner: [lesson("08.30-09.25")] }] },
            contacts: [{ name: "Lärare", email: "a@example.com" }]
        }],
        lov: { lov: [{ datum: "2026-10-26", beskrivning: "Höstlov" }], helgdagar: [] },
        terms: [{ termin: "HT", skolstart: [{ datum: "2026-08-19" }], skolavslutning: [] }]
    };
}

test("ett giltigt paket går igenom", () => {
    const out = core.normalizeBundle(validBundle());
    assert.equal(out.children.length, 1);
    assert.equal(out.children[0].contacts[0].mobile, "", "saknade fält blir tomma");
});

test("veckodagar normaliseras oavsett skiftläge", () => {
    const { schema, problems } = core.validateSchema({ schema: [{ dag: "tisdag", lektioner: [] }] });
    assert.deepEqual(plain(problems), []);
    assert.equal(schema.schema[0].dag, "Tisdag");
});

test("felstavad veckodag ger ett begripligt fel - tidigare visades bara 'Ingen skola'", () => {
    const { problems } = core.validateSchema({ schema: [{ dag: "Mån", lektioner: [] }] }, "Elev A");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Elev A/);
    assert.match(problems[0], /"Mån"/);
    assert.match(problems[0], /Måndag–Fredag/);
});

test("helgdagar i schemat flaggas", () => {
    const { problems } = core.validateSchema({ schema: [{ dag: "Lördag", lektioner: [] }] });
    assert.match(problems[0], /visar inte helger/);
});

test("samma dag två gånger flaggas", () => {
    const { problems } = core.validateSchema({
        schema: [{ dag: "Måndag", lektioner: [] }, { dag: "måndag", lektioner: [] }]
    });
    assert.match(problems[0], /två gånger/);
});

test("tider med fel format eller fel ordning flaggas", () => {
    const { problems } = core.validateSchema({
        schema: [{
            dag: "Måndag",
            lektioner: [
                lesson("8.5-9.00"),      // ensiffriga minuter: menade man 08.05 eller 08.50?
                lesson("09.00"),         // saknar sluttid
                lesson("10.00-09.00"),   // slutar före start
                lesson("08.30-09.25", "") // ämne saknas
            ]
        }]
    });
    assert.equal(problems.length, 4);
    assert.match(problems[0], /lektion 1.*fel format/);
    assert.match(problems[1], /lektion 2.*fel format/);
    assert.match(problems[2], /lektion 3.*inte efter starttiden/);
    assert.match(problems[3], /lektion 4.*"ämne" saknas/);
});

test("datum: fel format och datum som inte finns får olika besked", () => {
    const lov = core.validateLov({ lov: [{ datum: "2026-02-30" }, { datum: "26/10" }], helgdagar: [] });
    assert.equal(lov.problems.length, 2);
    assert.match(lov.problems[0], /"2026-02-30" finns inte/);
    assert.match(lov.problems[1], /"26\/10" ska skrivas ÅÅÅÅ-MM-DD/);
    const terms = core.validateTerms([{ termin: "HT", skolstart: [{ datum: "2026-13-01" }] }]);
    assert.match(terms.problems[0], /"HT".*finns inte/);
    assert.equal(core.validateTerms([{ skolstart: [{ datum: "2027-02-29" }] }]).problems.length, 1, "2027 är inget skottår");
    assert.equal(core.validateTerms([{ skolstart: [{ datum: "2028-02-29" }] }]).problems.length, 0, "men 2028 är det");
});

test("alla fel samlas i ett paket, inte bara det första", () => {
    const b = validBundle();
    b.children[0].schema.schema[0].dag = "Mån";
    b.lov.lov[0].datum = "fel";
    b.terms[0].skolstart[0].datum = "också fel";
    assert.throws(() => core.normalizeBundle(b), (err) => {
        assert.equal(err.problems.length, 3);
        assert.match(err.message, /^3 fel hittades:/);
        return true;
    });
});

test("äldre paket med gemensam kontaktlista fungerar fortfarande", () => {
    const b = validBundle();
    delete b.children[0].contacts;
    b.larare_kontakt = [{ name: "Gemensam" }];
    assert.equal(core.normalizeBundle(b).children[0].contacts[0].name, "Gemensam");
});

test("långa fellistor kortas av", () => {
    const msg = core.formatProblems(Array.from({ length: 12 }, (_, i) => `fel ${i + 1}`));
    assert.match(msg, /^12 fel hittades:/);
    assert.match(msg, /…och 4 till\./);
});

// De medföljande exempelfilerna ska klara samma kontroll som en import.
test("exempelfilerna i repot är giltiga", () => {
    for (const f of ["schema_elev_a.json", "schema_elev_b.json"]) {
        assert.deepEqual(plain(core.validateSchema(readJson(f), f).problems), [], f);
    }
    assert.deepEqual(plain(core.validateLov(readJson("lov_helg.json")).problems), []);
    assert.deepEqual(plain(core.validateTerms(readJson("termin.json")).problems), []);
});
