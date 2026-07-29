import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { filterGroups, patternMatch, twoGroupComparison, singletonsPerGenome, multiCopyCandidates, isNumericColumn, genomeNamesForPhenotypeValue } from "../src/analysis/topfilter.js";
import { applyWorkflowA } from "../src/parse/annotation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });

test("filterGroups: freqClasses restricts to matching classes", () => {
  const data = loadRoary();
  const core = filterGroups(data, { freqClasses: ["core"] });
  assert.deepEqual(core.map((g) => g.groupId).sort(), ["groupA", "groupD"]);
});

test("filterGroups: columnFilter text mode is a case-insensitive substring match on the chosen column", () => {
  const data = loadRoary();
  const hits = filterGroups(data, { columnFilter: { column: "annotation", mode: "text", text: "LACTAMASE" } });
  assert.deepEqual(hits.map((g) => g.groupId), ["groupA"]);
});

test("filterGroups: columnFilter text mode works on any column, e.g. freqClass", () => {
  const data = loadRoary();
  const hits = filterGroups(data, { columnFilter: { column: "freqClass", mode: "text", text: "shell" } });
  assert.deepEqual(hits.map((g) => g.groupId).sort(), ["groupB", "groupC"]);
});

test("filterGroups: columnFilter numeric mode compares with the chosen operator", () => {
  const data = loadRoary();
  const gt = filterGroups(data, { columnFilter: { column: "avgCopiesPerGenome", mode: "numeric", op: ">", value: 1.1 } });
  assert.deepEqual(gt.map((g) => g.groupId), ["groupD"]);
  const lte = filterGroups(data, { columnFilter: { column: "genomesPresentIn", mode: "numeric", op: "<=", value: 1 } });
  assert.deepEqual(lte.map((g) => g.groupId), ["groupC"]);
});

test("filterGroups: columnFilter with no text/value set is a no-op", () => {
  const data = loadRoary();
  const hits = filterGroups(data, { columnFilter: { column: "annotation", mode: "text", text: "" } });
  assert.equal(hits.length, data.meta.groupCount);
});

test("isNumericColumn recognises the fixed numeric columns and any dynamic matched-genes column", () => {
  assert.equal(isNumericColumn("genomesPresentIn"), true);
  assert.equal(isNumericColumn("sequencesTotal"), true);
  assert.equal(isNumericColumn("avgCopiesPerGenome"), true);
  assert.equal(isNumericColumn("annMatched_ann1_abc123"), true);
  assert.equal(isNumericColumn("annotation"), false);
  assert.equal(isNumericColumn("groupId"), false);
  assert.equal(isNumericColumn("ann_ann1_abc123"), false);
});

test("filterGroups: count and avg-copies bounds combine (AND)", () => {
  const data = loadRoary();
  const hits = filterGroups(data, { minGenomesPresentIn: 3, minAvgCopiesPerGenome: 1.1 });
  assert.deepEqual(hits.map((g) => g.groupId), ["groupD"]);
});

test("filterGroups: hasAnnotationValue restricts to groups with a non-empty value in a given uploaded annotation column", () => {
  const data = loadRoary();
  // groupC's cell is blank, groupD is unmatched entirely -> both should be excluded
  const text = [
    "group_id,annotation",
    "groupA,beta-lactamase",
    "groupB,hypothetical protein",
    "groupC,",
  ].join("\n");
  const { key } = applyWorkflowA(data, text);
  const hits = filterGroups(data, { hasAnnotationValue: [key] });
  assert.deepEqual(hits.map((g) => g.groupId).sort(), ["groupA", "groupB"]);
});

test("filterGroups: missingAnnotationValue restricts to groups with no value (blank cell or never matched) in a given uploaded annotation column", () => {
  const data = loadRoary();
  const text = [
    "group_id,annotation",
    "groupA,beta-lactamase",
    "groupB,hypothetical protein",
    "groupC,",
  ].join("\n");
  const { key } = applyWorkflowA(data, text);
  const hits = filterGroups(data, { missingAnnotationValue: [key] });
  // groupC: matched but blank cell; groupD: never matched at all — both count as "missing"
  assert.deepEqual(hits.map((g) => g.groupId).sort(), ["groupC", "groupD"]);
});

test("genomeNamesForPhenotypeValue matches only genomes with that exact value, excluding unset ones", () => {
  const data = loadRoary(); // genomes G1, G2, G3
  data.genomes.find((g) => g.name === "G1").phenotypes.resistance = "resistant";
  data.genomes.find((g) => g.name === "G2").phenotypes.resistance = "susceptible";
  // G3 left with no value at all for this key — must not match either level
  assert.deepEqual(genomeNamesForPhenotypeValue(data, "resistance", "resistant"), ["G1"]);
  assert.deepEqual(genomeNamesForPhenotypeValue(data, "resistance", "susceptible"), ["G2"]);
  assert.deepEqual(genomeNamesForPhenotypeValue(data, "resistance", "nonexistent-level"), []);
});

test("patternMatch: present-in and absent-from both apply", () => {
  const data = loadRoary();
  // groupB is present in G1/G2, absent from G3
  const hits = patternMatch(data, { presentIn: ["G1", "G2"], absentFrom: ["G3"] });
  assert.deepEqual(hits.map((g) => g.groupId), ["groupB"]);
});

test("patternMatch: empty criteria matches every group", () => {
  const data = loadRoary();
  assert.equal(patternMatch(data, {}).length, data.meta.groupCount);
});

test("twoGroupComparison: odds ratio and percentages for a clean split", () => {
  const data = loadRoary();
  // groupB present in G1,G2 (not G3): set A = [G1,G2], set B = [G3]
  const rows = twoGroupComparison(data, ["G1", "G2"], ["G3"]);
  const groupB = rows.find((r) => r.groupId === "groupB");
  assert.equal(groupB.presentA, 2);
  assert.equal(groupB.presentB, 0);
  assert.equal(groupB.pctA, 100);
  assert.equal(groupB.pctB, 0);
  assert.equal(groupB.correctedForZeroCell, true);
  assert.ok(groupB.oddsRatio > 1); // over-represented in A

  // results are sorted by |pctA - pctB| descending
  for (let i = 1; i < rows.length; i++) {
    const prevDiff = Math.abs(rows[i - 1].pctA - rows[i - 1].pctB);
    const curDiff = Math.abs(rows[i].pctA - rows[i].pctB);
    assert.ok(prevDiff >= curDiff - 1e-9);
  }
});

test("singletonsPerGenome: groupC (unique to G3) is attributed to G3 only", () => {
  const data = loadRoary();
  const byGenome = singletonsPerGenome(data);
  assert.deepEqual(byGenome.get("G1").map((g) => g.groupId), []);
  assert.deepEqual(byGenome.get("G3").map((g) => g.groupId), ["groupC"]);
});

test("multiCopyCandidates: groupD (avg 1.33 copies) passes a 1.2 threshold, others don't", () => {
  const data = loadRoary();
  const hits = multiCopyCandidates(data, 1.2);
  assert.deepEqual(hits.map((g) => g.groupId), ["groupD"]);
});

test("multiCopyCandidates: default threshold (1.5) excludes groupD (avg ~1.33)", () => {
  const data = loadRoary();
  const hits = multiCopyCandidates(data);
  assert.deepEqual(hits, []);
});
