import { test } from "node:test";
import assert from "node:assert/strict";

import { compareGenomicOrder } from "../src/render/heatmap.js";

function group(genomeFragment, orderWithinFragment) {
  return { genomeFragment, orderWithinFragment };
}

test("compareGenomicOrder sorts by fragment then by order within fragment", () => {
  const groups = [
    group("2", 1),
    group("1", 2),
    group("1", 1),
    group("2", 2),
  ];
  const sorted = [...groups].sort(compareGenomicOrder);
  assert.deepEqual(sorted, [group("1", 1), group("1", 2), group("2", 1), group("2", 2)]);
});

test("compareGenomicOrder treats numeric-looking fragment labels numerically, not lexically", () => {
  // Lexical sort would put "10" before "2" — numeric sort must not.
  const groups = [group("10", 1), group("2", 1), group("1", 1)];
  const sorted = [...groups].sort(compareGenomicOrder);
  assert.deepEqual(sorted.map((g) => g.genomeFragment), ["1", "2", "10"]);
});

test("compareGenomicOrder falls back to string comparison for non-numeric fragment labels", () => {
  const groups = [group("fragB", 1), group("fragA", 1)];
  const sorted = [...groups].sort(compareGenomicOrder);
  assert.deepEqual(sorted.map((g) => g.genomeFragment), ["fragA", "fragB"]);
});

test("compareGenomicOrder sinks groups with no fragment/order data to the end, without reordering among themselves", () => {
  const groups = [
    group(null, null),
    group("1", 2),
    group(null, null),
    group("1", 1),
  ];
  const sorted = [...groups].sort(compareGenomicOrder);
  assert.deepEqual(sorted.slice(0, 2), [group("1", 1), group("1", 2)]);
  assert.ok(sorted.slice(2).every((g) => g.genomeFragment === null));
});
