// clustering.js — lightweight client-side ordering for the heatmap's
// "sort by clustering" options, for both rows (gene groups) and columns
// (genomes) — build brief §6, Phase 3, extended on request to cover
// columns too. Not real hierarchical clustering/a dendrogram: a greedy
// nearest-neighbour chain, which is enough to visually pull similar
// rows/columns together without the cost of a full clustering algorithm.
//
// Cost model: ordering n items this way compares every pair at each of
// the n-1 steps, and each comparison costs O(m) (m = vector length —
// genomeCount for row/group vectors, groupCount for column/genome
// vectors), so the whole chain costs O(n^2 * m). Benchmarked in Node at
// ~340M such operations/sec. The previous flat cap (800 items,
// regardless of m) ignored the other axis entirely: at 800 groups and a
// large genome count (10,000) it measured ~18.6s, and at 500 genomes
// against 20,000 groups (the column-clustering case) ~14.7s — both far
// past "responsive" for something triggered from a dropdown. The cap
// below is instead computed from the n^2*m product against a fixed time
// budget, so it adapts to whichever axis is larger: a study with many
// groups gets a lower genome-clustering cap than one with few groups,
// and vice versa for row clustering.

import { presenceVector, genomeVector } from "../parse/matrix.js";

const OPS_BUDGET = 5e8; // ~1.5s at the benchmarked rate — generous since this is opt-in, not automatic
const MIN_CLUSTERABLE = 20;
const MAX_CLUSTERABLE = 5000; // absolute ceiling regardless of how small the other axis is

/** Largest number of items clusterOrder() will reorder, given each item's vector length. */
export function maxClusterableItems(vectorLength) {
  if (vectorLength <= 0) return MAX_CLUSTERABLE;
  const bound = Math.floor(Math.sqrt(OPS_BUDGET / vectorLength));
  return Math.max(MIN_CLUSTERABLE, Math.min(MAX_CLUSTERABLE, bound));
}

function jaccardSimilarity(a, b) {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x || y) union++;
    if (x && y) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

/** Negative squared Euclidean distance, so "higher is more similar" like jaccardSimilarity above. */
function euclideanSimilarity(a, b) {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sumSq += d * d;
  }
  return -sumSq;
}

const METRICS = { jaccard: jaccardSimilarity, euclidean: euclideanSimilarity };

/**
 * Order `items` (each an equal-length array/typed-array — presence bits
 * or copy counts) by a greedy nearest-neighbour chain. `metric` is
 * 'jaccard' (presence/absence overlap — the default, used for row/group
 * clustering) or 'euclidean' (magnitude-sensitive; better suited to
 * genome columns compared by copy number, since Jaccard treats any
 * non-zero count the same as any other). Both cost the same per
 * comparison — the metric choice doesn't change the O(n^2*m) cost, only
 * what similarity means. Returns an array of indices into `items` giving
 * the new order, or the identity order if there are too many items for
 * the current vector length to stay responsive (see maxClusterableItems).
 */
export function clusterOrder(items, opts = {}) {
  const n = items.length;
  const identity = items.map((_, i) => i);
  if (n <= 2) return identity;

  const vectorLength = items[0].length;
  if (n > maxClusterableItems(vectorLength)) return identity;

  const similarity = METRICS[opts.metric] || METRICS.jaccard;

  const visited = new Uint8Array(n);
  const order = [0];
  visited[0] = 1;
  let current = 0;

  for (let step = 1; step < n; step++) {
    let best = -1, bestSim = -Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const sim = similarity(items[current], items[i]);
      if (sim > bestSim) { bestSim = sim; best = i; }
    }
    order.push(best);
    visited[best] = 1;
    current = best;
  }

  return order;
}

/**
 * A group's presence vector (copy count per genome, in genome order) for
 * row-clustering/heatmap use — a zero-copy view straight into the shared
 * presence matrix.
 */
export function groupPresenceVector(data, groupIndex) {
  return presenceVector(data, groupIndex);
}

/**
 * A genome's copy-count vector across every group, for column
 * clustering. Unlike groupPresenceVector, this can't be a zero-copy view
 * (the presence matrix is group-major, so one genome's data is strided
 * rather than contiguous) — materialising it costs O(groupCount) per
 * genome, paid once per clustering action, same order as the heatmap's
 * own rasterisation pass.
 */
export function genomeColumnVector(data, genomeIndex) {
  return genomeVector(data, genomeIndex);
}
