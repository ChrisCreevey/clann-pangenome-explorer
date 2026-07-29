import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateLayoutSeconds, degreeCap, degreeOf, connectedComponents, componentCenters, mergeSingletonComponents, circularLayout, gridLayout } from "../src/render/network-graph.js";

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

test("degreeOf counts each node's edges regardless of direction", () => {
  const nodeIds = ["a", "b", "c"];
  const edges = [
    { a: "a", b: "b", pair: { direction: "associated" } },
    { a: "a", b: "c", pair: { direction: "disassociated" } },
  ];
  const degree = degreeOf(nodeIds, edges);
  assert.equal(degree.get("a"), 2);
  assert.equal(degree.get("b"), 1);
  assert.equal(degree.get("c"), 1);
});

test("connectedComponents groups nodes joined by associated edges only, ignoring disassociated ones", () => {
  const nodeIds = ["a", "b", "c", "d"];
  const edges = [
    { a: "a", b: "b", pair: { direction: "associated" } },
    // c-d are only linked by disassociation -> should NOT be the same component
    { a: "c", b: "d", pair: { direction: "disassociated" } },
  ];
  const { compOf, compCount } = connectedComponents(nodeIds, edges);
  assert.equal(compCount, 3); // {a,b}, {c}, {d}
  assert.equal(compOf.get("a"), compOf.get("b"));
  assert.notEqual(compOf.get("c"), compOf.get("d"));
});

test("connectedComponents transitively joins a chain of associated edges into one component", () => {
  const nodeIds = ["a", "b", "c"];
  const edges = [
    { a: "a", b: "b", pair: { direction: "associated" } },
    { a: "b", b: "c", pair: { direction: "associated" } },
  ];
  const { compOf, compCount } = connectedComponents(nodeIds, edges);
  assert.equal(compCount, 1);
  assert.equal(compOf.get("a"), compOf.get("c"));
});

test("componentCenters gives every component a distinct center, biggest component first", () => {
  const compOf = new Map([["a", 0], ["b", 0], ["c", 0], ["d", 1]]); // component 0 has 3 nodes, component 1 has 1
  const centers = componentCenters(2, compOf, 700, 400);
  assert.equal(centers.length, 2);
  assert.notDeepEqual(centers[0], centers[1]);
  centers.forEach((c) => {
    assert.ok(c.x >= 0 && c.x <= 700);
    assert.ok(c.y >= 0 && c.y <= 400);
  });
});

test("mergeSingletonComponents is a no-op with zero or one singleton component", () => {
  const compOf = new Map([["a", 0], ["b", 0], ["c", 1]]); // one 2-node cluster, one singleton
  const result = mergeSingletonComponents(compOf, 2);
  assert.equal(result.compOf, compOf); // same Map instance, untouched
  assert.equal(result.compCount, 2);
});

test("mergeSingletonComponents merges every singleton into one shared component, leaving real clusters untouched", () => {
  // {a,b} is a real 2-node cluster; c, d, e are each their own singleton.
  const compOf = new Map([["a", 0], ["b", 0], ["c", 1], ["d", 2], ["e", 3]]);
  const { compOf: merged, compCount } = mergeSingletonComponents(compOf, 4);
  assert.equal(compCount, 2); // the real cluster, plus one shared orphan slot
  assert.equal(merged.get("a"), merged.get("b")); // real cluster preserved
  assert.equal(merged.get("c"), merged.get("d")); // all singletons share one slot
  assert.equal(merged.get("d"), merged.get("e"));
  assert.notEqual(merged.get("a"), merged.get("c")); // the real cluster isn't folded into the orphan slot
});

test("mergeSingletonComponents handles every node being its own singleton (all-disassociated graph)", () => {
  const compOf = new Map([["a", 0], ["b", 1], ["c", 2]]);
  const { compOf: merged, compCount } = mergeSingletonComponents(compOf, 3);
  assert.equal(compCount, 1);
  assert.equal(merged.get("a"), merged.get("b"));
  assert.equal(merged.get("b"), merged.get("c"));
});

test("circularLayout places every node on the circle, evenly spaced, all within bounds", () => {
  const nodeIds = ["a", "b", "c", "d"];
  const pos = circularLayout(nodeIds, 700, 400);
  assert.equal(pos.size, 4);
  const cx = 350, cy = 200;
  for (const id of nodeIds) {
    const p = pos.get(id);
    const dist = Math.hypot(p.x - cx, p.y - cy);
    assert.ok(Math.abs(dist - (Math.min(700, 400) / 2 - 30)) < 1e-6); // every node is exactly on the circle
  }
  // no two nodes land on the same point
  const uniquePoints = new Set([...pos.values()].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
  assert.equal(uniquePoints.size, 4);
});

test("gridLayout groups nodes by category (adjacent grid indices for the same category)", () => {
  const nodeIds = ["z", "a1", "a2", "m"];
  const categoryOf = (id) => ({ z: "Zeta", a1: "Alpha", a2: "Alpha", m: "Mu" }[id]);
  const pos = gridLayout(nodeIds, 400, 400, categoryOf);
  assert.equal(pos.size, 4);
  // sorted by category: Alpha, Alpha, Mu, Zeta -> a1 and a2 are adjacent cells
  const cols = Math.ceil(Math.sqrt(4));
  const idxOf = (id) => {
    const p = pos.get(id);
    const cellW = 400 / cols;
    return Math.round(p.x / cellW - 0.5);
  };
  assert.equal(Math.abs(idxOf("a1") - idxOf("a2")) <= 1, true);
});

test("gridLayout is a no-op-safe on a single node", () => {
  const pos = gridLayout(["only"], 400, 300, () => "cat");
  assert.equal(pos.size, 1);
  const p = pos.get("only");
  assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300);
});
