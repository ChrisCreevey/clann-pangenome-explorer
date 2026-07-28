import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateLayoutSeconds, degreeCap } from "../src/render/network-graph.js";

test("estimateLayoutSeconds scales with n^2 (for UI hinting, not enforcement)", () => {
  const small = estimateLayoutSeconds(100);
  const large = estimateLayoutSeconds(1000); // 10x n -> ~100x the estimate
  assert.ok(large > small * 50);
});

test("estimateLayoutSeconds is negligible for a small graph and substantial for a large one", () => {
  assert.ok(estimateLayoutSeconds(50) < 0.1);
  // Matches the scale this gate exists for: tens of thousands of nodes,
  // as can arise from a large CoinFinder associated-pairs file.
  assert.ok(estimateLayoutSeconds(60000) > 60);
});

test("degreeCap is a no-op when the node count is already at or under topN", () => {
  const nodeIds = ["a", "b", "c"];
  const edges = [{ a: "a", b: "b" }, { a: "b", b: "c" }];
  const result = degreeCap(nodeIds, edges, 5);
  assert.deepEqual(result, { nodeIds, edges });
});

test("degreeCap is a no-op when topN is null (uncapped)", () => {
  const nodeIds = ["a", "b"];
  const edges = [{ a: "a", b: "b" }];
  assert.deepEqual(degreeCap(nodeIds, edges, null), { nodeIds, edges });
});

test("degreeCap keeps only the top-N highest-degree nodes and the edges among them", () => {
  // hub has degree 3 (connects to leaf1/leaf2/leaf3), leaves have degree 1 each,
  // and isolatedPair (degree 1 each) is a separate low-degree component.
  const nodeIds = ["hub", "leaf1", "leaf2", "leaf3", "isoA", "isoB"];
  const edges = [
    { a: "hub", b: "leaf1" },
    { a: "hub", b: "leaf2" },
    { a: "hub", b: "leaf3" },
    { a: "isoA", b: "isoB" },
  ];
  const result = degreeCap(nodeIds, edges, 3);
  // hub plus its two highest-degree-tied neighbours survive; isoA/isoB (degree 1, tied
  // with the excluded leaf) are cut since only 3 slots exist and hub must be one of them
  assert.ok(result.nodeIds.includes("hub"));
  assert.equal(result.nodeIds.length, 3);
  assert.ok(result.edges.every((e) => result.nodeIds.includes(e.a) && result.nodeIds.includes(e.b)));
});

test("degreeCap prunes a node that keeps its topN slot but ends up with no surviving edge", () => {
  // hub1 and hub2 are both selected (tied degree 2, sort first by insertion
  // order), but every edge in the graph connects a hub to a leaf, and no
  // leaf makes the cut — so hub1/hub2's own edges all get dropped too,
  // leaving them with none. A cap that only filtered the node *list* would
  // wrongly still report hub1/hub2 as included; degreeCap prunes them.
  const nodeIds = ["hub1", "hub2", "leafA", "leafB"];
  const edges = [
    { a: "hub1", b: "leafA" },
    { a: "hub1", b: "leafB" },
    { a: "hub2", b: "leafA" },
    { a: "hub2", b: "leafB" },
  ];
  const result = degreeCap(nodeIds, edges, 2);
  assert.deepEqual(result.nodeIds, []);
  assert.deepEqual(result.edges, []);
});
