import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { parseCoinfinderFile } from "../src/parse/coinfinder.js";
import { resolvePairs, categoryFor, categoryMatrix, crossCategoryPairs, sortBySignificance, filterPairs, groupAssociationSummary } from "../src/analysis/pairs.js";
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

function pairKeys(pairs) {
  return pairs.map((p) => `${p.groupIdA}-${p.groupIdB}`).sort();
}

test("filterPairs: annotationText matches either side's combined annotation text", () => {
  const data = loadWithPairs();
  // groupA's matrix annotation is "beta-lactamase" — appears in A-D (associated) and A-B (disassociated)
  const hits = filterPairs(data, data.pairs, { annotationText: "beta-lactamase" });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB", "groupA-groupD"]);
});

test("filterPairs: tags matches either side carrying any listed tag", () => {
  const data = loadWithPairs();
  keywordTag(data, "AMR", ["beta-lactamase"]); // groupA only
  const hits = filterPairs(data, data.pairs, { tags: ["AMR"] });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB", "groupA-groupD"]);
});

test("filterPairs: direction restricts to the listed directions", () => {
  const data = loadWithPairs();
  const hits = filterPairs(data, data.pairs, { direction: ["disassociated"] });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB", "groupC-groupD"]);
});

test("filterPairs: maxSignificance drops pairs above the threshold or with no value", () => {
  const data = loadWithPairs();
  const hits = filterPairs(data, data.pairs, { maxSignificance: 0.01 });
  assert.deepEqual(pairKeys(hits), ["groupA-groupD", "groupC-groupD"]);
});

test("filterPairs: crossCategoryOnly keeps only pairs whose sides differ in category", () => {
  const data = loadWithPairs();
  keywordTag(data, "AMR", ["beta-lactamase"]); // groupA only
  const hits = filterPairs(data, data.pairs, { crossCategoryOnly: true });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB", "groupA-groupD"]);
});

test("filterPairs: criteria combine as AND", () => {
  const data = loadWithPairs();
  keywordTag(data, "AMR", ["beta-lactamase"]); // groupA only
  const hits = filterPairs(data, data.pairs, { tags: ["AMR"], direction: ["disassociated"] });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB"]);
});

test("filterPairs: groupIds requires BOTH sides to be in the set, not either", () => {
  const data = loadWithPairs();
  // groupA-groupD: both in set -> kept. groupB-groupC: neither in set -> dropped.
  // groupA-groupB / groupC-groupD: only one side in set -> dropped (not "either" semantics).
  const hits = filterPairs(data, data.pairs, { groupIds: new Set(["groupA", "groupD"]) });
  assert.deepEqual(pairKeys(hits), ["groupA-groupD"]);
});

test("filterPairs: groupIds combines with other criteria as AND", () => {
  const data = loadWithPairs();
  const hits = filterPairs(data, data.pairs, { groupIds: new Set(["groupA", "groupB", "groupD"]) });
  assert.deepEqual(pairKeys(hits), ["groupA-groupB", "groupA-groupD"]);
});

test("groupAssociationSummary rolls up one row per group with associated/disassociated/total counts and the group's own fields", () => {
  const data = loadWithPairs();
  const rows = groupAssociationSummary(data.pairs);
  assert.equal(rows.length, 4); // groupA, groupD, groupB, groupC — each appears in exactly 2 pairs (1 associated, 1 disassociated)
  const groupA = rows.find((r) => r.groupId === "groupA");
  assert.equal(groupA.associated, 1);
  assert.equal(groupA.disassociated, 1);
  assert.equal(groupA.total, 2);
  // carries the group's own fields (spread), not just the counts
  assert.equal(groupA.annotation, "beta-lactamase");
  assert.equal(groupA.freqClass, "core");
});

test("groupAssociationSummary only includes groups that appear in the given pairs (e.g. an already-filtered selection)", () => {
  const data = loadWithPairs();
  const onlyAD = data.pairs.filter((p) => p.groupIdA === "groupA" && p.groupIdB === "groupD");
  const rows = groupAssociationSummary(onlyAD);
  assert.deepEqual(rows.map((r) => r.groupId).sort(), ["groupA", "groupD"]);
  assert.equal(rows.find((r) => r.groupId === "groupA").associated, 1);
  assert.equal(rows.find((r) => r.groupId === "groupA").disassociated, 0);
});
