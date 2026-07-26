import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { parseCoinfinderFile } from "../src/parse/coinfinder.js";
import { ColumnMappingNeeded } from "../src/parse/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });

test("parseCoinfinderFile detects ID and significance columns by name", () => {
  const data = loadRoary();
  const rows = parseCoinfinderFile(fixture("coinfinder-associated.csv"), data);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { groupIdA: "groupA", groupIdB: "groupD", significance: 0.001 });
  assert.equal(rows[2].groupIdB, "ghostGroup");
});

test("parseCoinfinderFile detects ID columns by matching loaded group IDs even without name hints", () => {
  const data = loadRoary();
  // header renamed to something with no name hints at all
  const text = "colX,colY,colZ\ngroupA,groupD,0.001\ngroupB,groupC,0.02\n";
  const rows = parseCoinfinderFile(text, data);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].groupIdA, "groupA");
  assert.equal(rows[0].groupIdB, "groupD");
  assert.equal(rows[0].significance, 0.001);
});

test("parseCoinfinderFile throws ColumnMappingNeeded when ID columns can't be identified", () => {
  const data = loadRoary();
  const text = "a,b,c\nx1,y1,0.5\nx2,y2,0.6\n";
  assert.throws(() => parseCoinfinderFile(text, data), ColumnMappingNeeded);
});

test("parseCoinfinderFile accepts an explicit manual column mapping", () => {
  const data = loadRoary();
  const text = "a,b,c\ngroupA,groupD,0.001\n";
  const rows = parseCoinfinderFile(text, data, { colA: 0, colB: 1, sigCol: 2 });
  assert.deepEqual(rows, [{ groupIdA: "groupA", groupIdB: "groupD", significance: 0.001 }]);
});
