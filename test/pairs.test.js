import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { parseCoinfinderFile } from "../src/parse/coinfinder.js";
import { resolvePairs, categoryFor, categoryMatrix, crossCategoryPairs, sortBySignificance } from "../src/analysis/pairs.js";
import { keywordTag } from "../src/analysis/tags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

function loadWithPairs() {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const assocRows = parseCoinfinderFile(fixture("coinfinder-associated.csv"), data);
  const disassocRows = parseCoinfinderFile(fixture("coinfinder-disassociated.csv"), data);
  resolvePairs(data, assocRows, "associated");
  resolvePairs(data, disassocRows, "disassociated");
  return data;
}

test("resolvePairs splits matched pairs into data.pairs and unmatched ones into data.unmatchedPairs", () => {
  const data = loadWithPairs();
  // associated: groupA-groupD (match), groupB-groupC (match), groupA-ghostGroup (unmatched)
  // disassociated: groupA-groupB (match), groupC-groupD (match)
  assert.equal(data.pairs.length, 4);
  assert.equal(data.unmatchedPairs.length, 1);
  assert.equal(data.unmatchedPairs[0].groupIdB, "ghostGroup");
  assert.equal(data.unmatchedPairs[0].resolvedB, null);
});

test("categoryFor falls back to 'uncategorised' for an untagged group", () => {
  const data = loadWithPairs();
  const groupC = data.groups.find((g) => g.groupId === "groupC");
  assert.equal(categoryFor(groupC), "uncategorised");
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(categoryFor(groupA), "AMR");
});

test("categoryMatrix counts associated/disassociated pairs per unordered category combo", () => {
  const data = loadWithPairs();
  keywordTag(data, "AMR", ["beta-lactamase"]); // tags groupA only
  const matrix = categoryMatrix(data);
  // groupA(AMR)-groupD(uncategorised) associated; groupB-groupC(both uncategorised) associated;
  // groupA(AMR)-groupB(uncategorised) disassociated; groupC-groupD(both uncategorised) disassociated
  const amrUncat = matrix.find((m) => m.key === "AMR × uncategorised");
  const uncatUncat = matrix.find((m) => m.key === "uncategorised × uncategorised");
  assert.equal(amrUncat.associated, 1);
  assert.equal(amrUncat.disassociated, 1);
  assert.equal(uncatUncat.associated, 1);
  assert.equal(uncatUncat.disassociated, 1);
});

test("crossCategoryPairs finds only pairs whose two sides differ in category", () => {
  const data = loadWithPairs();
  keywordTag(data, "AMR", ["beta-lactamase"]); // groupA only
  const cross = crossCategoryPairs(data);
  // groupA(AMR) appears in 2 pairs (groupA-groupD associated, groupA-groupB disassociated), both cross-category
  assert.equal(cross.length, 2);
  assert.ok(cross.every((p) => p.groupIdA === "groupA" || p.groupIdB === "groupA"));
});

test("sortBySignificance orders by significance ascending, nulls last, ignoring category", () => {
  const data = loadWithPairs();
  const sorted = sortBySignificance(data.pairs);
  assert.deepEqual(sorted.map((p) => p.significance), [0.001, 0.001, 0.02, 0.04]);
});
