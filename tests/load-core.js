// Läser kärnblocket <script id="skolapp-core"> ur index.html och kör det i en egen
// kontext. Testerna kör alltså exakt den kod som appen kör - det finns ingen kopia
// att hålla i synk.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const INDEX = path.join(__dirname, "..", "index.html");

function loadCore() {
    const html = fs.readFileSync(INDEX, "utf8");
    const match = html.match(/<script id="skolapp-core">([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Hittade inget <script id="skolapp-core"> i index.html');

    const context = vm.createContext({ console });
    vm.runInContext(match[1], context, { filename: "index.html#skolapp-core" });
    return context.SkolappCore;
}

module.exports = { loadCore };
