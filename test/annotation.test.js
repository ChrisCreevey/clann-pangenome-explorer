import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { detectAnnotationWorkflow, applyWorkflowA, applyWorkflowB, buildGeneToGroupIndex } from "../src/parse/annotation.js";

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

test("applyWorkflowA joins annotations directly onto matching groups", () => {
  const data = loadRoary();
  const { matched, unmatchedIds } = applyWorkflowA(data, fixture("annotation-workflow-a.csv"));
  assert.equal(matched, 4);
  assert.deepEqual(unmatchedIds, []);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(groupA.annotation, "beta-lactamase (updated)");
  assert.equal(data.meta.annotationWorkflow, "A");
});

test("applyWorkflowB computes consensus, consistency score, and full breakdown", () => {
  const data = loadRoary();
  const { matched, unmatchedIds, acceptedCount, rejectedCount } = applyWorkflowB(data, fixture("annotation-workflow-b.csv"), { minCount: 1, minPercent: 50 });
  assert.equal(matched, 10); // 11 rows minus 1 unmatched
  assert.deepEqual(unmatchedIds, ["unknown_gene_99"]);
  assert.equal(acceptedCount, 4);
  assert.equal(rejectedCount, 0);

  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(groupA.consensusAnnotation, "beta-lactamase");
  assert.equal(groupA.annotation, "beta-lactamase");
  assert.ok(Math.abs(groupA.consistencyScore - 2 / 3) < 1e-9);
  assert.equal(groupA.annotationBreakdown.length, 2);
  assert.equal(groupA.annotationBreakdown[0].annotation, "beta-lactamase");
  assert.equal(groupA.annotationBreakdown[0].count, 2);

  const groupD = data.groups.find((g) => g.groupId === "groupD");
  assert.equal(groupD.consensusAnnotation, "transporter");
  assert.ok(Math.abs(groupD.consistencyScore - 0.75) < 1e-9);
});

test("applyWorkflowB rejects a consensus below minPercent, keeping the breakdown visible", () => {
  const data = loadRoary();
  const { acceptedCount, rejectedCount } = applyWorkflowB(data, fixture("annotation-workflow-b.csv"), { minCount: 1, minPercent: 70 });
  // groupA is 66.7% -> rejected; groupB/groupC/groupD are 100/100/75 -> accepted
  assert.equal(acceptedCount, 3);
  assert.equal(rejectedCount, 1);

  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.equal(groupA.consensusAnnotation, null);
  assert.equal(groupA.annotation, null);
  // breakdown is still recorded even though no consensus was accepted
  assert.equal(groupA.annotationBreakdown.length, 2);
});
