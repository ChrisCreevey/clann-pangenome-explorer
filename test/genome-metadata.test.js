import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse, ColumnMappingNeeded } from "../src/parse/index.js";
import { applyGenomeMetadata } from "../src/parse/genome-metadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" }); // genomes G1, G2, G3

test("applyGenomeMetadata matches genomes by ID and records one phenotype source per non-ID column", () => {
  const data = loadRoary();
  const text = [
    "genome_id,resistance,host",
    "G1,resistant,human",
    "G2,susceptible,human",
    "G3,resistant,bovine",
  ].join("\n");

  const { matched, unmatchedIds, sources } = applyGenomeMetadata(data, text);
  assert.equal(matched, 3);
  assert.deepEqual(unmatchedIds, []);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map((s) => s.header), ["resistance", "host"]);

  const [resistanceKey, hostKey] = sources.map((s) => s.key);
  assert.equal(data.genomes.find((g) => g.name === "G1").phenotypes[resistanceKey], "resistant");
  assert.equal(data.genomes.find((g) => g.name === "G2").phenotypes[resistanceKey], "susceptible");
  assert.equal(data.genomes.find((g) => g.name === "G3").phenotypes[hostKey], "bovine");

  assert.deepEqual(sources[0].distinctValues, ["resistant", "susceptible"]);
  assert.deepEqual(sources[1].distinctValues, ["bovine", "human"]);
});

test("applyGenomeMetadata reports unmatched genome IDs without touching data.genomes", () => {
  const data = loadRoary();
  const text = [
    "genome_id,resistance",
    "G1,resistant",
    "G_unknown,susceptible",
  ].join("\n");

  const { matched, unmatchedIds, sources } = applyGenomeMetadata(data, text);
  assert.equal(matched, 1);
  assert.deepEqual(unmatchedIds, ["G_unknown"]);
  assert.equal(sources[0].matched, 1);
});

test("applyGenomeMetadata leaves a blank cell unset rather than storing an empty string", () => {
  const data = loadRoary();
  const text = [
    "genome_id,resistance",
    "G1,resistant",
    "G2,",
  ].join("\n");

  const { sources } = applyGenomeMetadata(data, text);
  const key = sources[0].key;
  assert.equal(data.genomes.find((g) => g.name === "G1").phenotypes[key], "resistant");
  assert.equal(data.genomes.find((g) => g.name === "G2").phenotypes[key], undefined);
  assert.equal(sources[0].matched, 1); // only G1 counted, not the row-level match count of 2
});

test("applyGenomeMetadata supports a second upload adding another phenotype column without disturbing the first", () => {
  const data = loadRoary();
  applyGenomeMetadata(data, ["genome_id,resistance", "G1,resistant", "G2,susceptible", "G3,resistant"].join("\n"));
  applyGenomeMetadata(data, ["genome_id,host", "G1,human", "G2,human", "G3,bovine"].join("\n"));

  assert.equal(data.meta.phenotypeSources.length, 2);
  const [resistanceKey, hostKey] = data.meta.phenotypeSources.map((s) => s.key);
  const g1 = data.genomes.find((g) => g.name === "G1");
  assert.equal(g1.phenotypes[resistanceKey], "resistant");
  assert.equal(g1.phenotypes[hostKey], "human");
});

test("applyGenomeMetadata throws ColumnMappingNeeded when no column looks like a genome-ID column", () => {
  const data = loadRoary();
  const text = ["foo,bar", "1,2", "3,4"].join("\n");
  assert.throws(() => applyGenomeMetadata(data, text), ColumnMappingNeeded);
});

test("applyGenomeMetadata respects a manual idCol override", () => {
  const data = loadRoary();
  // "sample" doesn't match the ID-name heuristic and values don't match genome names by position 0
  const text = ["label,sample", "some-label,G1", "another-label,G2"].join("\n");
  const { matched, sources } = applyGenomeMetadata(data, text, { idCol: 1 });
  assert.equal(matched, 2);
  assert.deepEqual(sources.map((s) => s.header), ["label"]);
});
