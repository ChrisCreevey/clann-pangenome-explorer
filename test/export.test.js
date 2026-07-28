import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { parseCoinfinderFile } from "../src/parse/coinfinder.js";
import { resolvePairs } from "../src/analysis/pairs.js";
import { keywordTag } from "../src/analysis/tags.js";
import { applyWorkflowA } from "../src/parse/annotation.js";
import { geneIdListText, geneIdTableCsv, groupTableCsv, multiCopyCandidatesCsv, MULTICOPY_EXPORT_FILENAME } from "../export/group-export.js";
import { pairsToDelimited, pairsToCytoscapeEdgeTable } from "../export/pair-export.js";
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

test("pairsToDelimited exports category/freqClass/annotation for both sides of each pair, plus one column pair per uploaded annotation source", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const assocRows = parseCoinfinderFile(fixture("coinfinder-associated.csv"), data);
  resolvePairs(data, assocRows, "associated");
  const filtered = data.pairs.filter((p) => p.groupIdA === "groupA" || p.groupIdB === "groupA");

  const csvNoAnnotationUpload = pairsToDelimited(data, filtered);
  assert.equal(csvNoAnnotationUpload, "group_id_a,category_a,freq_class_a,annotation_a,direction,significance,group_id_b,category_b,freq_class_b,annotation_b\ngroupA,AMR,core,beta-lactamase,associated,0.001,groupD,uncategorised,core,transporter\n");

  applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  const csvWithAnnotationUpload = pairsToDelimited(data, filtered);
  const lines = csvWithAnnotationUpload.trim().split("\n");
  assert.equal(lines[0], "group_id_a,category_a,freq_class_a,annotation_a,direction,significance,group_id_b,category_b,freq_class_b,annotation_b,annotation A,annotation B");
  assert.equal(lines[1], "groupA,AMR,core,beta-lactamase,associated,0.001,groupD,uncategorised,core,transporter,beta-lactamase (updated),efflux pump");
});

test("pairsToCytoscapeEdgeTable uses Cytoscape's source/target/interaction column convention and lists both directions together", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const assocRows = parseCoinfinderFile(fixture("coinfinder-associated.csv"), data);
  const disassocRows = parseCoinfinderFile(fixture("coinfinder-disassociated.csv"), data);
  resolvePairs(data, assocRows, "associated");
  resolvePairs(data, disassocRows, "disassociated");

  const csv = pairsToCytoscapeEdgeTable(data.pairs);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "source,target,interaction,significance,source_category,target_category,source_freq_class,target_freq_class,source_annotation,target_annotation,source_tags,target_tags");
  // both directions present in the same table, not split into separate exports
  assert.ok(lines.some((l) => l.includes(",associated,")));
  assert.ok(lines.some((l) => l.includes(",disassociated,")));
  const groupARow = lines.find((l) => l.startsWith("groupA,groupD,"));
  assert.equal(groupARow, "groupA,groupD,associated,0.001,AMR,uncategorised,core,core,beta-lactamase,transporter,AMR,");
});
