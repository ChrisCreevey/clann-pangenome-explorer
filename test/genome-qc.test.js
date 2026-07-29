import { test } from "node:test";
import assert from "node:assert/strict";

import { flagGenomeOutliers, describeQcReason, DEFAULT_QC_THRESHOLDS } from "../src/analysis/genome-qc.js";

function genome(name, totalGenes, uniqueGenes, coreGenesPresent) {
  return { name, totalGenes, uniqueGenes, coreGenesPresent };
}

test("flagGenomeOutliers flags a genome with low core-gene coverage relative to the population median", () => {
  const genomes = [
    genome("G1", 1000, 5, 950),
    genome("G2", 1000, 5, 950),
    genome("G3", 1000, 5, 950),
    genome("G4", 400, 5, 300), // well below the others' core coverage
  ];
  const { flagged, medianCore } = flagGenomeOutliers(genomes, DEFAULT_QC_THRESHOLDS);
  assert.equal(medianCore, 950);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].genome.name, "G4");
  assert.equal(flagged[0].reasons[0].type, "lowCore");
});

test("flagGenomeOutliers flags a genome with a high unique-gene count relative to the population median", () => {
  const genomes = [
    genome("G1", 1000, 10, 950),
    genome("G2", 1000, 10, 950),
    genome("G3", 1000, 10, 950),
    genome("G4", 1000, 80, 950), // far more unique genes than the rest — contamination-like
  ];
  const { flagged, medianUnique } = flagGenomeOutliers(genomes, DEFAULT_QC_THRESHOLDS);
  assert.equal(medianUnique, 10);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].genome.name, "G4");
  assert.equal(flagged[0].reasons[0].type, "highUnique");
});

test("flagGenomeOutliers can flag both reasons on the same genome", () => {
  const genomes = [
    genome("G1", 1000, 10, 950),
    genome("G2", 1000, 10, 950),
    genome("G3", 300, 90, 200), // both low core and high unique
  ];
  const { flagged } = flagGenomeOutliers(genomes, DEFAULT_QC_THRESHOLDS);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].reasons.length, 2);
  assert.deepEqual(flagged[0].reasons.map((r) => r.type).sort(), ["highUnique", "lowCore"]);
});

test("flagGenomeOutliers flags nothing when every genome is close to the population median", () => {
  const genomes = [genome("G1", 1000, 10, 950), genome("G2", 990, 9, 945), genome("G3", 1010, 11, 955)];
  const { flagged } = flagGenomeOutliers(genomes, DEFAULT_QC_THRESHOLDS);
  assert.deepEqual(flagged, []);
});

test("flagGenomeOutliers doesn't trip the high-unique rule when the population median is 0", () => {
  // no genome has any unique genes at all -> a 3x-of-zero cutoff must not trivially flag every genome with >0
  const genomes = [genome("G1", 1000, 0, 950), genome("G2", 1000, 0, 950), genome("G3", 1000, 5, 950)];
  const { flagged } = flagGenomeOutliers(genomes, DEFAULT_QC_THRESHOLDS);
  assert.deepEqual(flagged, []);
});

test("flagGenomeOutliers thresholds are adjustable", () => {
  const genomes = [genome("G1", 1000, 10, 950), genome("G2", 1000, 10, 950), genome("G3", 1000, 10, 800)];
  // 800/950 ≈ 84% -> not flagged at the default 90% cutoff... wait, 84% < 90%, so it WOULD be flagged by default;
  // use a looser threshold (80%) to confirm it stops being flagged once the cutoff is relaxed.
  const strict = flagGenomeOutliers(genomes, { lowCorePct: 90, highUniqueMultiplier: 3 });
  const loose = flagGenomeOutliers(genomes, { lowCorePct: 80, highUniqueMultiplier: 3 });
  assert.equal(strict.flagged.length, 1);
  assert.equal(loose.flagged.length, 0);
});

test("describeQcReason produces a readable summary for both reason types", () => {
  const lowCore = { type: "lowCore", value: 300, median: 950, cutoff: 855 };
  const highUnique = { type: "highUnique", value: 80, median: 10, cutoff: 30 };
  assert.match(describeQcReason(lowCore), /core genes present: 300/);
  assert.match(describeQcReason(highUnique), /unique genes: 80/);
});
