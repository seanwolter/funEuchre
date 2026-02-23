import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
const sourceEntry = join(process.cwd(), "src", "main.tsx");
const htmlEntry = join(process.cwd(), "index.html");
const builtEntry = join(process.cwd(), "dist", "main.js");
test("web source defines baseline route shell", async () => {
    const source = await readFile(sourceEntry, "utf8");
    assert.match(source, /type RouteKey = "lobby" \| "game" \| "help"/);
    assert.match(source, /initializeShell\(\)/);
});
test("web index wires app root and bundle", async () => {
    const html = await readFile(htmlEntry, "utf8");
    assert.match(html, /<div id="app"><\/div>/);
    assert.match(html, /dist\/main\.js/);
});
test("web build artifact is generated", async () => {
    await access(builtEntry, constants.R_OK);
    const builtSource = await readFile(builtEntry, "utf8");
    assert.ok(builtSource.length > 0);
});
