// clustering.js — lightweight client-side ordering for the heatmap's
// "sort by clustering" option (build brief §6, Phase 3). Not a real
// hierarchical clustering/dendrogram: a greedy nearest-neighbour chain
// ordering by Jaccard similarity of presence vectors, which is enough to
// visually pull similar rows/columns together without the cost of a full
// clustering algorithm. Capped for very large matrices to stay responsive.

const MAX_CLUSTER_ITEMS = 800;

function jaccardSimilarity(a, b) {
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x || y) union++;
    if (x && y) intersection++;
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * Order `items` (each an array/typed-array of 0/1 presence bits, same
 * length) by a greedy nearest-neighbour chain. Returns an array of indices
 * into `items` giving the new order. Falls back to the identity order
 * above MAX_CLUSTER_ITEMS (heatmap should show a "too many rows to cluster"
 * note in that case rather than silently taking a long time).
 */
export function clusterOrder(items) {
  const n = items.length;
  const identity = items.map((_, i) => i);
  if (n <= 2 || n > MAX_CLUSTER_ITEMS) return identity;

  const visited = new Uint8Array(n);
  const order = [0];
  visited[0] = 1;
  let current = 0;

  for (let step = 1; step < n; step++) {
    let best = -1, bestSim = -Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const sim = jaccardSimilarity(items[current], items[i]);
      if (sim > bestSim) { bestSim = sim; best = i; }
    }
    order.push(best);
    visited[best] = 1;
    current = best;
  }

  return order;
}

export { MAX_CLUSTER_ITEMS };

/** Build a group's presence vector (0/1 per genome, in genome order) for clustering/heatmap use. */
export function groupPresenceVector(group, genomeNames) {
  return genomeNames.map((name) => (group.cells[name] && group.cells[name].copyCount > 0 ? 1 : 0));
}
