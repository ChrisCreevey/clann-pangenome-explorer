import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { parseCoinfinderFile } from "../src/parse/coinfinder.js";
import { resolvePairs } from "../src/analysis/pairs.js";
import { keywordTag } from "../src/analysis/tags.js";
import { geneIdListText, geneIdTableCsv, groupTableCsv, multiCopyCandidatesCsv, MULTICOPY_EXPORT_FILENAME } from "../export/group-export.js";
import { pairsToDelimited } from "../export/pair-export.js";
import { escapeField, toDelimited } from "../export/csv-util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });

test("escapeField quotes only when necessary", () => {
  assert.equal(escapeField("plain", ","), "plain");
  assert.equal(escapeField("has,comma", ","), '"has,comma"');
  assert.equal(escapeField('has"quote', ","), '"has""quote"');
  assert.equal(escapeField(null, ","), "");
  assert.equal(escapeField(5, ","), "5");
});

test("toDelimited builds a header row plus one row per entry", () => {
  const out = toDelimited(["a", "b"], [["1", "2"], ["3", "4"]], ",");
  assert.equal(out, "a,b\n1,2\n3,4\n");
});

test("geneIdListText returns a sorted, deduplicated, one-per-line gene ID list", () => {
  const data = loadRoary();
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const groupD = data.groups.find((g) => g.groupId === "groupD");
  const text = geneIdListText(data, [groupA, groupD]);
  assert.equal(text, "groupA_1\ngroupA_2\ngroupA_3\ngroupD_1\ngroupD_1b\ngroupD_2\ngroupD_3\n");
});

test("geneIdListText on an empty group set produces an empty string", () => {
  const data = loadRoary();
  assert.equal(geneIdListText(data, []), "");
});

test("geneIdTableCsv keeps group/genome traceability for every constituent gene", () => {
  const data = loadRoary();
  const groupB = data.groups.find((g) => g.groupId === "groupB");
  const csv = geneIdTableCsv(data, [groupB]);
  assert.equal(csv, "group_id,genome,gene_id\ngroupB,G1,groupB_1\ngroupB,G2,groupB_2\n");
});

test("groupTableCsv includes tags joined with a semicolon", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const csv = groupTableCsv(data, [groupA]);
  assert.equal(csv, `group_id,annotation,freq_class,genomes_present_in,sequences_total,avg_copies_per_genome,tags\ngroupA,beta-lactamase,core,3,3,1,AMR\n`);
});

test("multiCopyCandidatesCsv formats avg copies to 2 decimal places", () => {
  const data = loadRoary();
  const groupD = data.groups.find((g) => g.groupId === "groupD");
  const csv = multiCopyCandidatesCsv([groupD]);
  assert.equal(csv, "group_id,annotation,freq_class,genomes_present_in,sequences_total,avg_copies_per_genome\ngroupD,transporter,core,3,4,1.33\n");
});

test("MULTICOPY_EXPORT_FILENAME is the placeholder name pending Clann naming confirmation", () => {
  assert.equal(MULTICOPY_EXPORT_FILENAME, "multicopy-candidates.csv");
});

test("pairsToDelimited exports category/freqClass for both sides of each pair", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const assocRows = parseCoinfinderFile(fixture("coinfinder-associated.csv"), data);
  resolvePairs(data, assocRows, "associated");
  const csv = pairsToDelimited(data.pairs.filter((p) => p.groupIdA === "groupA" || p.groupIdB === "groupA"));
  assert.equal(csv, "group_id_a,category_a,freq_class_a,direction,significance,group_id_b,category_b,freq_class_b\ngroupA,AMR,core,associated,0.001,groupD,uncategorised,core\n");
});
