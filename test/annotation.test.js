import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { detectAnnotationWorkflow, applyWorkflowA, applyWorkflowB, buildGeneToGroupIndex, annotationSearchText, reorderAnnotationSource } from "../src/parse/annotation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });

test("buildGeneToGroupIndex maps every constituent gene ID back to its group", () => {
  const data = loadRoary();
  const index = buildGeneToGroupIndex(data);
  assert.equal(index.get("groupA_1"), "groupA");
  assert.equal(index.get("groupD_1b"), "groupD");
  assert.equal(index.size, 3 + 2 + 1 + 4); // groupA(3) + groupB(2) + groupC(1) + groupD(4)
});

test("detectAnnotationWorkflow recognises a one-row-per-group file as Workflow A", () => {
  const data = loadRoary();
  assert.equal(detectAnnotationWorkflow(data, fixture("annotation-workflow-a.csv")), "A");
});

test("detectAnnotationWorkflow recognises a one-row-per-gene file as Workflow B", () => {
  const data = loadRoary();
  assert.equal(detectAnnotationWorkflow(data, fixture("annotation-workflow-b.csv")), "B");
});

test("applyWorkflowA adds a new column keyed by the file's own header, without touching the matrix annotation", () => {
  const data = loadRoary();
  const { matched, unmatchedIds, key, header } = applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  assert.equal(matched, 4);
  assert.deepEqual(unmatchedIds, []);
  assert.equal(header, "annotation"); // fixture's own column header
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(groupA.annotationColumns[key].value, "beta-lactamase (updated)");
  assert.equal(groupA[`ann_${key}`], "beta-lactamase (updated)");
  // the matrix's own annotation column (from the Roary file) is unchanged
  assert.equal(groupA.annotation, "beta-lactamase");
  assert.equal(data.meta.annotationSources.length, 1);
  assert.equal(data.meta.annotationSources[0].workflow, "A");
});

test("a second upload adds a second column instead of overwriting the first", () => {
  const data = loadRoary();
  applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  const { key: key2 } = applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  assert.equal(data.meta.annotationSources.length, 2);
  // duplicate header text is disambiguated
  assert.equal(data.meta.annotationSources[1].header, "annotation (2)");
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(Object.keys(groupA.annotationColumns).length, 2);
  assert.equal(groupA.annotationColumns[key2].value, "beta-lactamase (updated)");
});

test("re-applying with an explicit sourceKey updates the existing column instead of adding a new one", () => {
  const data = loadRoary();
  const { key } = applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  applyWorkflowA(data, fixture("annotation-workflow-a.csv"), { sourceKey: key });
  assert.equal(data.meta.annotationSources.length, 1);
});

test("applyWorkflowB computes consensus, consistency score, matched-gene count, and full breakdown in its own column", () => {
  const data = loadRoary();
  const { matched, unmatchedIds, acceptedCount, rejectedCount, key } = applyWorkflowB(data, fixture("annotation-workflow-b.csv"), { minCount: 1, minPercent: 50 });
  assert.equal(matched, 10); // 11 rows minus 1 unmatched
  assert.deepEqual(unmatchedIds, ["unknown_gene_99"]);
  assert.equal(acceptedCount, 4);
  assert.equal(rejectedCount, 0);

  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const colA = groupA.annotationColumns[key];
  assert.equal(colA.value, "beta-lactamase");
  assert.equal(groupA[`ann_${key}`], "beta-lactamase");
  assert.equal(groupA[`annMatched_${key}`], 3);
  assert.ok(Math.abs(colA.consistencyScore - 2 / 3) < 1e-9);
  assert.equal(colA.breakdown.length, 2);
  assert.equal(colA.breakdown[0].annotation, "beta-lactamase");
  assert.equal(colA.breakdown[0].count, 2);
  // matrix annotation untouched
  assert.equal(groupA.annotation, "beta-lactamase");

  const groupD = data.groups.find((g) => g.groupId === "groupD");
  const colD = groupD.annotationColumns[key];
  assert.equal(colD.value, "transporter");
  assert.ok(Math.abs(colD.consistencyScore - 0.75) < 1e-9);
});

test("applyWorkflowB rejects a consensus below minPercent, keeping the breakdown and matched count visible", () => {
  const data = loadRoary();
  const { acceptedCount, rejectedCount, key } = applyWorkflowB(data, fixture("annotation-workflow-b.csv"), { minCount: 1, minPercent: 70 });
  // groupA is 66.7% -> rejected; groupB/groupC/groupD are 100/100/75 -> accepted
  assert.equal(acceptedCount, 3);
  assert.equal(rejectedCount, 1);

  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const colA = groupA.annotationColumns[key];
  assert.equal(colA.value, null);
  assert.equal(groupA[`ann_${key}`], null);
  // breakdown and matched count are still recorded even though no consensus was accepted
  assert.equal(colA.breakdown.length, 2);
  assert.equal(colA.matchedCount, 3);
});

test("reorderAnnotationSource moves a source earlier or later, no-op past either end", () => {
  const data = loadRoary();
  const { key: keyA } = applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  const { key: keyB } = applyWorkflowB(data, fixture("annotation-workflow-b.csv"));
  assert.deepEqual(data.meta.annotationSources.map((s) => s.key), [keyA, keyB]);

  reorderAnnotationSource(data, keyB, -1);
  assert.deepEqual(data.meta.annotationSources.map((s) => s.key), [keyB, keyA]);

  reorderAnnotationSource(data, keyB, -1); // already first, no-op
  assert.deepEqual(data.meta.annotationSources.map((s) => s.key), [keyB, keyA]);

  reorderAnnotationSource(data, keyA, 1); // already last, no-op
  assert.deepEqual(data.meta.annotationSources.map((s) => s.key), [keyB, keyA]);
});

test("annotationSearchText combines the matrix annotation with every uploaded column", () => {
  const data = loadRoary();
  applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const text = annotationSearchText(data, groupA);
  assert.ok(text.includes("beta-lactamase")); // matrix annotation
  assert.ok(text.includes("updated")); // uploaded column's value
});
