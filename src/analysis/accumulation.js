// accumulation.js — pangenome and core-genome accumulation curves, built
// from client-side random subsampling permutations (build brief §6, Phase 3).
// Capped and flagged as approximate for large genome sets. Uses a seeded
// PRNG so results (and tests) are deterministic for a given seed.

const DEFAULT_PERMUTATIONS = 20;
// Above this many genomes, permutations are capped harder to stay responsive
// in the browser — the curve is already a statistical approximation, so a
// smaller permutation count doesn't meaningfully change its shape.
const LARGE_GENOME_COUNT = 200;
const LARGE_GENOME_PERMUTATIONS = 8;

/** Deterministic seeded PRNG (mulberry32) — same seed always gives the same sequence. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(array, rng) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Compute pangenome-size and core-genome-size accumulation curves.
 * Returns { genomeCounts, pangenomeMean, coreMean, pangenomeStd, coreStd,
 * permutations, approximate }, one entry per genome count 1..N (index 0 = 1 genome).
 */
export function computeAccumulationCurves(data, opts = {}) {
  const genomeNames = data.genomes.map((g) => g.name);
  const n = genomeNames.length;
  const seed = opts.seed ?? 1;
  const approximate = n > LARGE_GENOME_COUNT;
  const permutations = opts.permutations ?? (approximate ? LARGE_GENOME_PERMUTATIONS : DEFAULT_PERMUTATIONS);

  if (n === 0) {
    return { genomeCounts: [], pangenomeMean: [], coreMean: [], pangenomeStd: [], coreStd: [], permutations, approximate };
  }

  // presence[groupIndex] = Set of genome indices the group is present in
  const presenceBits = data.groups.map((g) => {
    const bits = new Uint8Array(n);
    genomeNames.forEach((name, i) => { bits[i] = g.cells[name] && g.cells[name].copyCount > 0 ? 1 : 0; });
    return bits;
  });

  const rng = mulberry32(seed);
  const pangenomeSums = new Array(n).fill(0);
  const pangenomeSumsSq = new Array(n).fill(0);
  const coreSums = new Array(n).fill(0);
  const coreSumsSq = new Array(n).fill(0);

  const indices = genomeNames.map((_, i) => i);

  for (let p = 0; p < permutations; p++) {
    const order = shuffled(indices, rng);
    const seenAny = new Uint8Array(presenceBits.length);
    const seenCount = new Int32Array(presenceBits.length); // how many of the sampled genomes so far have this group
    let pangenomeSize = 0;
    let genomesIncluded = 0;

    for (let k = 0; k < n; k++) {
      const genomeIdx = order[k];
      genomesIncluded++;
      for (let g = 0; g < presenceBits.length; g++) {
        if (presenceBits[g][genomeIdx]) {
          if (!seenAny[g]) { seenAny[g] = 1; pangenomeSize++; }
          seenCount[g]++;
        }
      }
      let coreSize = 0;
      for (let g = 0; g < presenceBits.length; g++) {
        if (seenCount[g] === genomesIncluded) coreSize++;
      }
      pangenomeSums[k] += pangenomeSize;
      pangenomeSumsSq[k] += pangenomeSize * pangenomeSize;
      coreSums[k] += coreSize;
      coreSumsSq[k] += coreSize * coreSize;
    }
  }

  const genomeCounts = indices.map((_, i) => i + 1);
  const pangenomeMean = pangenomeSums.map((s) => s / permutations);
  const coreMean = coreSums.map((s) => s / permutations);
  const std = (sums, sumsSq) => sums.map((s, i) => {
    const mean = s / permutations;
    const variance = Math.max(0, sumsSq[i] / permutations - mean * mean);
    return Math.sqrt(variance);
  });

  return {
    genomeCounts,
    pangenomeMean,
    coreMean,
    pangenomeStd: std(pangenomeSums, pangenomeSumsSq),
    coreStd: std(coreSums, coreSumsSq),
    permutations,
    approximate,
  };
}
