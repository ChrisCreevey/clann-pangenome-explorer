import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse, detectFormat, ColumnMappingNeeded, parsePresenceCell, parseRoaryFromLines } from "../src/parse/index.js";
import { assignFrequencyClasses, frequencyClassCounts, frequencySpectrum, adjustThresholds, DEFAULT_THRESHOLDS } from "../src/analysis/frequency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("parsePresenceCell handles blank, numeric, and gene-ID-list cells", () => {
  assert.deepEqual(parsePresenceCell(""), { copyCount: 0, geneIds: [] });
  assert.deepEqual(parsePresenceCell("0"), { copyCount: 0, geneIds: [] });
  assert.deepEqual(parsePresenceCell("2"), { copyCount: 2, geneIds: [] });
  assert.deepEqual(parsePresenceCell("groupA_1"), { copyCount: 1, geneIds: ["groupA_1"] });
  assert.deepEqual(parsePresenceCell("groupA_1;groupA_1b"), { copyCount: 2, geneIds: ["groupA_1", "groupA_1b"] });
});

/** Simulate stream-lines.js's line splitting straight off a string, for parseRoaryFromLines tests. */
async function* linesOf(text) {
  for (const line of text.split(/\r\n|\r|\n/)) yield line;
}

test("parseRoaryFromLines (streaming) matches parse() (in-memory) for the same Roary matrix", async () => {
  const text = fixture("roary-small.csv");
  const fromText = parse(text, { filename: "gene_presence_absence.csv" });
  const fromStream = await parseRoaryFromLines(linesOf(text), { filename: "gene_presence_absence.csv" });

  assert.deepEqual(fromStream.genomes.map((g) => g.name), fromText.genomes.map((g) => g.name));
  assert.equal(fromStream.meta.groupCount, fromText.meta.groupCount);
  assert.deepEqual(Array.from(fromStream.presenceMatrix), Array.from(fromText.presenceMatrix));
  assert.deepEqual(fromStream.groups.map((g) => g.groupId), fromText.groups.map((g) => g.groupId));
});

test("parseRoaryFromLines throws a diagnostic error for a header-only stream", async () => {
  await assert.rejects(
    () => parseRoaryFromLines(linesOf("Gene,Non-unique Gene name,Annotation,G1,G2\n"), {}),
    /no data rows/
  );
});

test("detectFormat recognises Roary by header shape", () => {
  const text = fixture("roary-small.csv");
  assert.equal(detectFormat("gene_presence_absence.csv", text), "roary");
  assert.equal(detectFormat("unrelated.csv", text), "roary");
});

test("parses a Roary matrix into PangenomeData with correct group and genome stats", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  assert.equal(data.meta.format, "roary");
  assert.equal(data.meta.genomeCount, 3);
  assert.equal(data.meta.groupCount, 4);
  assert.deepEqual(data.genomes.map((g) => g.name), ["G1", "G2", "G3"]);

  const byId = Object.fromEntries(data.groups.map((g) => [g.groupId, g]));
  assert.equal(byId.groupA.annotation, "beta-lactamase");
  assert.equal(byId.groupA.genomesPresentIn, 3);
  assert.equal(byId.groupA.freqClass, "core");

  assert.equal(byId.groupB.genomesPresentIn, 2);
  assert.equal(byId.groupB.freqClass, "shell");

  assert.equal(byId.groupC.genomesPresentIn, 1);
  assert.equal(byId.groupC.annotation, null);

  // groupD has two copies in G1 (semicolon-separated allele IDs in one cell)
  assert.equal(byId.groupD.genomesPresentIn, 3);
  assert.equal(byId.groupD.sequencesTotal, 4);
  assert.equal(byId.groupD.freqClass, "core");
  assert.ok(byId.groupD.avgCopiesPerGenome > 1);

  const g1 = data.genomes.find((g) => g.name === "G1");
  // present in G1: groupA(1) + groupB(1) + groupD(2 copies) = 4 total genes
  assert.equal(g1.totalGenes, 4);
  // core genes present in G1: groupA + groupD (both core) = 2
  assert.equal(g1.coreGenesPresent, 2);
});

test("parses a PIRATE gene_families.tsv, rolling allele calls up to group cells", () => {
  const data = parse(fixture("pirate-small.tsv"), { filename: "PIRATE.gene_families.tsv" });
  assert.equal(data.meta.format, "pirate");
  assert.equal(data.meta.genomeCount, 3);

  const byId = Object.fromEntries(data.groups.map((g) => [g.groupId, g]));
  assert.equal(byId.famX.annotation, "beta-lactamase");
  assert.equal(byId.famX.genomesPresentIn, 3);
  assert.equal(byId.famX.freqClass, "core");

  assert.equal(byId.famY.genomesPresentIn, 2);
  assert.equal(byId.famY.annotation, "hypothetical protein");
});

test("parses a PanACoTA family x genome matrix", () => {
  const data = parse(fixture("panacota-small.csv"), { filename: "PanACoTA-pangenome.csv" });
  assert.equal(data.meta.format, "panacota");
  assert.equal(data.meta.genomeCount, 3);
  assert.equal(data.meta.groupCount, 3);

  const byId = Object.fromEntries(data.groups.map((g) => [g.groupId, g]));
  assert.equal(byId["1"].genomesPresentIn, 3);
  assert.equal(byId["1"].freqClass, "core");
  assert.equal(byId["3"].genomesPresentIn, 1);
});

test("generic-matrix fallback parses an unambiguous plain matrix without a mapping prompt", () => {
  const data = parse(fixture("generic-matrix-plain.csv"), { filename: "custom.csv" });
  assert.equal(data.meta.format, "generic-matrix");
  assert.equal(data.meta.genomeCount, 2);
  assert.equal(data.meta.groupCount, 2);
});

test("generic-matrix fallback throws ColumnMappingNeeded when the ID column is ambiguous", () => {
  assert.throws(
    () => parse(fixture("generic-matrix-ambiguous.csv"), { filename: "custom.csv" }),
    (err) => {
      assert.ok(err instanceof ColumnMappingNeeded);
      assert.ok(err.previewRows.length > 0);
      assert.deepEqual(err.previewHeader, ["id", "alt_id", "G1", "G2"]);
      return true;
    }
  );
});

test("generic-matrix fallback accepts an explicit manual mapping", () => {
  const data = parse(fixture("generic-matrix-ambiguous.csv"), {
    filename: "custom.csv",
    groupIdColumn: 0,
    genomeColumns: [2, 3],
  });
  assert.equal(data.meta.genomeCount, 2);
  assert.equal(data.groups[0].groupId, "grpA");
});

test("assignFrequencyClasses recomputes classes and coreGenesPresent under new thresholds", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  // With a shell floor above groupB/groupC's presence (66.7%/33.3%), they drop to cloud.
  assignFrequencyClasses(data, { core: 99, softcore: 95, shell: 70 });
  const byId = Object.fromEntries(data.groups.map((g) => [g.groupId, g]));
  assert.equal(byId.groupB.freqClass, "cloud");
  assert.equal(byId.groupC.freqClass, "cloud");
  assert.equal(byId.groupA.freqClass, "core");

  // restore defaults for isolation from other tests using the same fixture object shape
  assignFrequencyClasses(data, DEFAULT_THRESHOLDS);
});

test("frequencyClassCounts and frequencySpectrum summarise groups correctly", () => {
  const data = parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });
  const counts = frequencyClassCounts(data);
  assert.equal(counts.core, 2); // groupA, groupD
  assert.equal(counts.shell, 2); // groupB, groupC

  const spectrum = frequencySpectrum(data);
  assert.equal(spectrum.length, 3);
  assert.equal(spectrum[0], 1); // groupC present in exactly 1 genome
  assert.equal(spectrum[1], 1); // groupB present in exactly 2 genomes
  assert.equal(spectrum[2], 2); // groupA, groupD present in all 3
});

test("adjustThresholds leaves valid thresholds unchanged", () => {
  const next = adjustThresholds(DEFAULT_THRESHOLDS, "core", 99);
  assert.deepEqual(next, DEFAULT_THRESHOLDS);
});

test("adjustThresholds cascades softcore and shell down when core is lowered below them", () => {
  const next = adjustThresholds(DEFAULT_THRESHOLDS, "core", 10);
  assert.equal(next.core, 10);
  assert.equal(next.softcore, 9); // was 95, now must be < 10
  assert.equal(next.shell, 8); // was 15, now must be < 9
});

test("adjustThresholds clamps softcore below core when raised too high, cascading to shell", () => {
  const next = adjustThresholds(DEFAULT_THRESHOLDS, "softcore", 99);
  assert.equal(next.core, 99);
  assert.equal(next.softcore, 98); // clamped below core
  assert.equal(next.shell, 15); // unaffected, still below the new softcore
});

test("adjustThresholds clamps shell below softcore when raised too high", () => {
  const next = adjustThresholds(DEFAULT_THRESHOLDS, "shell", 95);
  assert.equal(next.core, 99);
  assert.equal(next.softcore, 95);
  assert.equal(next.shell, 94); // clamped below softcore
});

test("adjustThresholds rounds and clamps raw input to [0, 100]", () => {
  assert.equal(adjustThresholds(DEFAULT_THRESHOLDS, "core", 150).core, 100);
  assert.equal(adjustThresholds(DEFAULT_THRESHOLDS, "shell", -5).shell, 0);
  assert.equal(adjustThresholds(DEFAULT_THRESHOLDS, "core", 82.6).core, 83);
});

test("adjustThresholds does not mutate the previous thresholds object", () => {
  const prev = { ...DEFAULT_THRESHOLDS };
  adjustThresholds(prev, "core", 5);
  assert.deepEqual(prev, DEFAULT_THRESHOLDS);
});
