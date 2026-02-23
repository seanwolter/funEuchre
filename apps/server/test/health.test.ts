import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const sourceEntry = join(process.cwd(), "src", "index.ts");
const builtEntry = join(process.cwd(), "dist", "index.js");

test("server source defines health endpoint behavior", async () => {
  const source = await readFile(sourceEntry, "utf8");
  assert.match(source, /\/health/);
  assert.match(source, /status:\s*"ok"/);
});

test("server build artifact is generated", async () => {
  await access(builtEntry, constants.R_OK);
  const builtSource = await readFile(builtEntry, "utf8");
  assert.match(builtSource, /health/);
});
