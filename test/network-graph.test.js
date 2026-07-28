import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateLayoutSeconds } from "../src/render/network-graph.js";

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
