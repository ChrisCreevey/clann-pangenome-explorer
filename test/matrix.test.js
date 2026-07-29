import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMatrix, StreamingMatrixBuilder, geneIdsAt, allGeneIdsForGroup, geneIdsByGenomeForGroup } from "../src/parse/matrix.js";

// genomeCount = 20 so occupancy ratios cleanly straddle the 0.1 dense/sparse threshold.
const GENOME_COUNT = 20;

function fakeData(geneIdsByGroup, presenceMatrix) {
  return {
    meta: { genomeCount: GENOME_COUNT },
    genomes: Array.from({ length: GENOME_COUNT }, (_, i) => ({ name: `G${i}`, index: i })),
    geneIdsByGroup,
    presenceMatrix,
  };
}

test("buildMatrix stores a sparse row (below occupancy threshold) as a Map", () => {
  // 1 of 20 genomes populated (5% occupancy) -> sparse.
  const rawRow = new Array(GENOME_COUNT).fill("");
  rawRow[3] = "geneA_1";
  const { presenceMatrix, geneIdsByGroup } = buildMatrix([{ groupId: "g", rawRow }], GENOME_COUNT);
  assert.ok(geneIdsByGroup[0] instanceof Map);
  const data = fakeData(geneIdsByGroup, presenceMatrix);
  assert.deepEqual(geneIdsAt(data, 0, 3), ["geneA_1"]);
  assert.deepEqual(geneIdsAt(data, 0, 0), []);
});

test("buildMatrix stores a dense row (above occupancy threshold) as a plain Array, single ID unwrapped", () => {
  // 15 of 20 genomes populated (75% occupancy) -> dense.
  const rawRow = new Array(GENOME_COUNT).fill("");
  for (let i = 0; i < 15; i++) rawRow[i] = `gene_${i}`;
  const { presenceMatrix, geneIdsByGroup } = buildMatrix([{ groupId: "g", rawRow }], GENOME_COUNT);
  assert.ok(Array.isArray(geneIdsByGroup[0]) && !(geneIdsByGroup[0] instanceof Map));
  const data = fakeData(geneIdsByGroup, presenceMatrix);
  assert.deepEqual(geneIdsAt(data, 0, 7), ["gene_7"]);
  assert.deepEqual(geneIdsAt(data, 0, 16), []); // unpopulated slot within a dense row
});

test("multi-copy cells (>1 gene ID) still return the full list in both dense and sparse rows", () => {
  const sparseRow = new Array(GENOME_COUNT).fill("");
  sparseRow[1] = "geneA_1;geneA_1b";
  const denseRow = new Array(GENOME_COUNT).fill("");
  for (let i = 0; i < 16; i++) denseRow[i] = i === 5 ? "geneB_1,geneB_2" : `gene_${i}`;

  const { presenceMatrix, geneIdsByGroup } = buildMatrix(
    [{ groupId: "sparse", rawRow: sparseRow }, { groupId: "dense", rawRow: denseRow }],
    GENOME_COUNT
  );
  const data = fakeData(geneIdsByGroup, presenceMatrix);
  assert.deepEqual(geneIdsAt(data, 0, 1), ["geneA_1", "geneA_1b"]);
  assert.deepEqual(geneIdsAt(data, 1, 5), ["geneB_1", "geneB_2"]);
});

test("allGeneIdsForGroup and geneIdsByGenomeForGroup agree between dense and sparse row storage", () => {
  const sparseRow = new Array(GENOME_COUNT).fill("");
  sparseRow[2] = "x1";
  sparseRow[9] = "x2;x3";
  const denseRow = new Array(GENOME_COUNT).fill("");
  for (let i = 0; i < 18; i++) denseRow[i] = `y${i}`;

  const { presenceMatrix, geneIdsByGroup } = buildMatrix(
    [{ groupId: "sparse", rawRow: sparseRow }, { groupId: "dense", rawRow: denseRow }],
    GENOME_COUNT
  );
  const data = fakeData(geneIdsByGroup, presenceMatrix);

  assert.deepEqual(new Set(allGeneIdsForGroup(data, 0)), new Set(["x1", "x2", "x3"]));
  assert.equal(allGeneIdsForGroup(data, 1).length, 18);

  const sparseByGenome = geneIdsByGenomeForGroup(data, 0);
  assert.deepEqual(sparseByGenome.find(([name]) => name === "G2")[1], ["x1"]);
  assert.deepEqual(sparseByGenome.find(([name]) => name === "G9")[1], ["x2", "x3"]);

  const denseByGenome = geneIdsByGenomeForGroup(data, 1);
  assert.equal(denseByGenome.length, 18);
  assert.deepEqual(denseByGenome.find(([name]) => name === "G0")[1], ["y0"]);
});

test("StreamingMatrixBuilder produces identical presenceMatrix and gene-ID results to buildMatrix, across the dense/sparse boundary", () => {
  const rows = [];
  // sparse row
  const sparse = new Array(GENOME_COUNT).fill("");
  sparse[4] = "s1";
  rows.push(sparse);
  // dense row, multi-copy cell included
  const dense = new Array(GENOME_COUNT).fill("");
  for (let i = 0; i < 17; i++) dense[i] = i === 10 ? "d10a;d10b" : `d${i}`;
  rows.push(dense);
  // fully empty row
  rows.push(new Array(GENOME_COUNT).fill(""));

  const rawGroups = rows.map((rawRow, i) => ({ groupId: `g${i}`, rawRow }));
  const fromBuild = buildMatrix(rawGroups, GENOME_COUNT);

  const builder = new StreamingMatrixBuilder(GENOME_COUNT, 1); // tiny initial capacity forces growth
  for (const rawRow of rows) builder.addRow(rawRow);
  const fromStream = builder.finish();

  assert.deepEqual(Array.from(fromStream.presenceMatrix), Array.from(fromBuild.presenceMatrix));

  const dataBuild = fakeData(fromBuild.geneIdsByGroup, fromBuild.presenceMatrix);
  const dataStream = fakeData(fromStream.geneIdsByGroup, fromStream.presenceMatrix);
  for (let groupIndex = 0; groupIndex < rows.length; groupIndex++) {
    assert.deepEqual(
      new Set(allGeneIdsForGroup(dataStream, groupIndex)),
      new Set(allGeneIdsForGroup(dataBuild, groupIndex))
    );
  }
  assert.equal(fromStream.geneIdsByGroup[2], undefined); // the fully-empty row
});
