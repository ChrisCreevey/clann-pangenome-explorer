// clustering.js — lightweight client-side ordering for the heatmap's
// "sort by clustering" options, for both rows (gene groups) and columns
// (genomes) — build brief §6, Phase 3, extended to cover columns too.
// Not real hierarchical clustering/a dendrogram: a greedy nearest-
// neighbour chain, which is enough to visually pull similar rows/columns
// together without the cost of a full clustering algorithm.
//
// Cost model: ordering n items this way compares every pair at each of
// the n-1 steps, and each comparison costs O(m) (m = vector length —
// genomeCount for row/group vectors, groupCount for column/genome
// vectors), so the whole chain costs O(n^2 * m). Benchmarked in Node at
// ~340M such operations/sec.
//
// This used to silently fall back to the identity order above a
// computed item cap. That was a judgment call about what counts as
// "too slow", not a technical limit — the user gets to decide whether
// they want to wait, not have the tool decide for them. So clusterOrder()
// now always actually clusters (there's still an ABSOLUTE_MAX circuit
// breaker far beyond anything realistic, purely against a degenerate
// input hanging the tab indefinitely with no way out — not a UX
// judgment). estimateClusterSeconds() is exposed so the UI can show an
// honest time estimate before the user commits, and the caller is
// expected to show a busy indicator (src/render/busy.js) for the
// duration, since this is a synchronous, main-thread-blocking
// computation — there is no Web Worker here, so the rest of the page is
// genuinely unresponsive while it runs, and a large-enough choice can
// trigger the browser's own "Page Unresponsive" prompt. That's an
// honest cost of the "let the user choose" approach, not a bug.

import { presenceVector, genomeVector } from "../parse/matrix.js";

const BENCHMARKED_OPS_PER_SECOND = 3.4e8; // measured in Node; a real-world browser tab may be somewhat slower
const ABSOLUTE_MAX_ITEMS = 20000; // circuit breaker only — see comment above

/** Rough wall-clock estimate for clustering `n` items with vector length `vectorLength`, for UI hinting only. */
export function estimateClusterSeconds(n, vectorLength) {
  return (n * n * vectorLength) / BENCHMARKED_OPS_PER_SECOND;
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
 * what similarity means. This is a synchronous, main-thread-blocking
 * call for however long the dataset takes — callers should run it via
 * runBusy() (src/render/busy.js) and, for large n, warn the user first
 * with estimateClusterSeconds(). Returns an array of indices into
 * `items` giving the new order (identity order for n<=2, or above
 * ABSOLUTE_MAX_ITEMS as a last-resort circuit breaker).
 */
export function clusterOrder(items, opts = {}) {
  const n = items.length;
  const identity = items.map((_, i) => i);
  if (n <= 2 || n > ABSOLUTE_MAX_ITEMS) return identity;

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
