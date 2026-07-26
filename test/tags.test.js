import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parse } from "../src/parse/index.js";
import { keywordTag, listUploadTag, clearTag, listTags } from "../src/analysis/tags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const loadRoary = () => parse(fixture("roary-small.csv"), { filename: "gene_presence_absence.csv" });

test("keywordTag tags every group whose annotation matches, case-insensitively", () => {
  const data = loadRoary();
  const count = keywordTag(data, "AMR", ["beta-lactamase"]);
  assert.equal(count, 1);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.deepEqual(groupA.tags, ["AMR"]);
});

test("keywordTag does not double-tag a group that already carries the tag", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  const secondCount = keywordTag(data, "AMR", ["beta-lactamase"]);
  assert.equal(secondCount, 0);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.deepEqual(groupA.tags, ["AMR"]);
});

test("keywordTag supports multiple terms (OR match)", () => {
  const data = loadRoary();
  const count = keywordTag(data, "misc", ["beta-lactamase", "hypothetical"]);
  assert.equal(count, 2); // groupA (beta-lactamase) and groupB (hypothetical protein)
});

test("listUploadTag joins a two-column group-ID/category file, reporting unmatched IDs", () => {
  const data = loadRoary();
  const { matched, unmatchedIds } = listUploadTag(data, fixture("tags-list.csv"));
  assert.equal(matched, 3);
  assert.deepEqual(unmatchedIds, ["ghostGroup"]);
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  const groupD = data.groups.find((g) => g.groupId === "groupD");
  const groupB = data.groups.find((g) => g.groupId === "groupB");
  assert.deepEqual(groupA.tags, ["AMR"]);
  assert.deepEqual(groupD.tags, ["AMR"]);
  assert.deepEqual(groupB.tags, ["Virulence"]);
});

test("a group can hold more than one tag (flat label set, no hierarchy)", () => {
  const data = loadRoary();
  keywordTag(data, "AMR", ["beta-lactamase"]);
  listUploadTag(data, "group_id,category\ngroupA,Virulence\n");
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.deepEqual(groupA.tags.sort(), ["AMR", "Virulence"]);
});

test("clearTag removes a tag from every group that carries it", () => {
  const data = loadRoary();
  listUploadTag(data, fixture("tags-list.csv"));
  const removed = clearTag(data, "AMR");
  assert.equal(removed, 2); // groupA, groupD
  const groupA = data.groups.find((g) => g.groupId === "groupA");
  assert.deepEqual(groupA.tags, []);
});

test("listTags summarises distinct tags with per-tag group counts, most-used first", () => {
  const data = loadRoary();
  listUploadTag(data, fixture("tags-list.csv"));
  assert.deepEqual(listTags(data), [
    { tag: "AMR", count: 2 },
    { tag: "Virulence", count: 1 },
  ]);
});
