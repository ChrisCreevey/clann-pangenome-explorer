import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { computeAccumulationCurves } from "../src/analysis/accumulation.js";
import { clusterOrder, groupPresenceVector } from "../src/analysis/clustering.js";

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
