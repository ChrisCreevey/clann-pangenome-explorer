import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { computeAccumulationCurves } from "../src/analysis/accumulation.js";
import { clusterOrder, groupPresenceVector, genomeColumnVector, maxClusterableItems } from "../src/analysis/clustering.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("computeAccumulationCurves is deterministic under a fixed seed", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const a = computeAccumulationCurves(data, { seed: 7, permutations: 10 });
  const b = computeAccumulationCurves(data, { seed: 7, permutations: 10 });
  assert.deepEqual(a.pangenomeMean, b.pangenomeMean);
  assert.deepEqual(a.coreMean, b.coreMean);
});

test("computeAccumulationCurves: pangenome size is non-decreasing and core size is non-increasing", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const curves = computeAccumulationCurves(data, { seed: 3, permutations: 15 });
  for (let i = 1; i < curves.genomeCounts.length; i++) {
    assert.ok(curves.pangenomeMean[i] >= curves.pangenomeMean[i - 1] - 1e-9);
    assert.ok(curves.coreMean[i] <= curves.coreMean[i - 1] + 1e-9);
  }
  // at all genomes sampled, pangenome size should equal total group count
  const last = curves.genomeCounts.length - 1;
  assert.equal(curves.pangenomeMean[last], data.meta.groupCount);
});

test("computeAccumulationCurves handles a single genome", () => {
  const data = parse(fixture("generic-matrix-plain.csv"), { filename: "custom.csv", groupIdColumn: 0, genomeColumns: [1] });
  const curves = computeAccumulationCurves(data, { seed: 1, permutations: 5 });
  assert.equal(curves.genomeCounts.length, 1);
});

test("clusterOrder returns a permutation of all indices and groups identical vectors together", () => {
  const items = [
    [1, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 1, 0, 1],
    [0, 0, 1, 0],
  ];
  const order = clusterOrder(items);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3]);
  // items 0 and 2 are near-identical (differ in one position) and should end up adjacent
  const pos = (i) => order.indexOf(i);
  assert.ok(Math.abs(pos(0) - pos(2)) === 1);
});

test("groupPresenceVector reflects genome membership (copy count) in genome order", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const groupB = data.groups.find((g) => g.groupId === "groupB");
  assert.deepEqual([...groupPresenceVector(data, groupB.groupIndex)], [1, 1, 0]);
});

test("genomeColumnVector reflects a genome's copy count across every group, in group order", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const g1 = data.genomes.find((g) => g.name === "G1");
  // roary-small.csv groups in file order: groupA(1), groupB(1), groupC(0), groupD(2, semicolon-joined multi-copy)
  assert.deepEqual([...genomeColumnVector(data, g1.index)], [1, 1, 0, 2]);
});

test("clusterOrder falls back to identity order once item count exceeds the vector-length-aware cap", () => {
  const longVector = new Array(1000).fill(0); // maxClusterableItems(1000) is small
  const cap = maxClusterableItems(1000);
  const items = Array.from({ length: cap + 1 }, () => longVector);
  const order = clusterOrder(items);
  assert.deepEqual(order, items.map((_, i) => i)); // identity — too many items to cluster at this vector length
});

test("maxClusterableItems shrinks as vector length grows, and grows as it shrinks", () => {
  const capForLarge = maxClusterableItems(20000);
  const capForSmall = maxClusterableItems(500);
  assert.ok(capForLarge < capForSmall);
});

test("clusterOrder with the euclidean metric groups similar copy-number vectors together, distinguishing magnitude that jaccard would treat as identical", () => {
  const items = [
    [0, 0, 5], // far from the "1 copy" cluster below despite all being non-zero in the same position
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 6],
  ];
  const order = clusterOrder(items, { metric: "euclidean" });
  const pos = (i) => order.indexOf(i);
  // items 0 and 3 (copy numbers 5 and 6) should end up adjacent; jaccard would
  // have seen items 0/1/2 as more similar (all just "non-zero somewhere").
  assert.ok(Math.abs(pos(0) - pos(3)) === 1);
});
