// accumulation.js — pangenome and core-genome accumulation curves, built
// from client-side random subsampling permutations (build brief §6, Phase 3).
// Capped and flagged as approximate for large genome/group counts. Uses a
// seeded PRNG so results (and tests) are deterministic for a given seed.
//
// Algorithm note: adding one genome at a time naively costs O(groupCount)
// per step (rescan every group to update pangenome/core state), so a full
// curve costs O(permutations * genomeCount * groupCount). At real
// large-study scale (e.g. 10,000 genomes x 20,000 groups) that dominates
// the entire render (~30s measured before this fix). Two changes remove
// nearly all of that:
//   1. Which groups are present in each genome is precomputed once
//      (O(genomeCount * groupCount), unavoidable — every cell must be
//      looked at at least once — but paid once, not once per permutation).
//   2. Core-size tracking uses a candidate set that only ever shrinks
//      (a group leaving the "present in every genome so far" set can never
//      rejoin it), so each step only re-examines the groups still in
//      contention instead of every group in the dataset. In practice this
//      collapses to near-zero after a few dozen genomes for any dataset
//      with a real accessory genome, since shell/cloud genes drop out of
//      contention almost immediately.
// Permutation count is also capped by genomeCount * groupCount jointly
// (previously genome count only), so a study with many genomes but few
// groups — or few genomes but very many groups — both get scaled
// appropriately rather than only the former being caught.

import { presenceVector } from "../parse/matrix.js";

const DEFAULT_PERMUTATIONS = 20;
const MIN_PERMUTATIONS = 3;
// Calibrated against the optimised algorithm below: at this many
// (genomeCount * groupCount) "cells", DEFAULT_PERMUTATIONS full passes
// should complete in a couple of seconds. Above it, permutations scale
// down inversely so the total work stays roughly constant.
const BASELINE_CELL_BUDGET = 2_000_000;

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

/** For each genome index, the list of group indices present in it (built once). */
function buildPresentGroupsPerGenome(data, genomeCount, groupCount) {
  const perGenome = Array.from({ length: genomeCount }, () => []);
  for (const g of data.groups) {
    const vector = presenceVector(data, g.groupIndex);
    for (let i = 0; i < genomeCount; i++) {
      if (vector[i] > 0) perGenome[i].push(g.groupIndex);
    }
  }
  return perGenome;
}

function choosePermutations(explicit, genomeCount, groupCount) {
  if (explicit != null) return explicit;
  const cells = genomeCount * groupCount;
  const scaled = Math.floor((BASELINE_CELL_BUDGET * DEFAULT_PERMUTATIONS) / Math.max(cells, 1));
  return Math.max(MIN_PERMUTATIONS, Math.min(DEFAULT_PERMUTATIONS, scaled));
}

/**
 * Compute pangenome-size and core-genome-size accumulation curves.
 * Returns { genomeCounts, pangenomeMean, coreMean, pangenomeStd, coreStd,
 * permutations, approximate }, one entry per genome count 1..N (index 0 = 1 genome).
 */
export function computeAccumulationCurves(data, opts = {}) {
  const n = data.meta.genomeCount;
  const groupCount = data.groups.length;
  const seed = opts.seed ?? 1;
  const permutations = choosePermutations(opts.permutations, n, groupCount);
  const approximate = permutations < DEFAULT_PERMUTATIONS;

  if (n === 0) {
    return { genomeCounts: [], pangenomeMean: [], coreMean: [], pangenomeStd: [], coreStd: [], permutations, approximate };
  }

  const presentGroupsPerGenome = buildPresentGroupsPerGenome(data, n, groupCount);

  const rng = mulberry32(seed);
  const pangenomeSums = new Array(n).fill(0);
  const pangenomeSumsSq = new Array(n).fill(0);
  const coreSums = new Array(n).fill(0);
  const coreSumsSq = new Array(n).fill(0);

  const indices = presentGroupsPerGenome.map((_, i) => i);

  // Shared across permutations: presentMark[g] === version means "group g
  // is present in the genome currently being added", checked without ever
  // needing to clear the array between steps.
  const presentMark = new Int32Array(groupCount).fill(-1);
  let version = 0;

  for (let p = 0; p < permutations; p++) {
    const order = shuffled(indices, rng);
    const seenAny = new Uint8Array(groupCount);
    let pangenomeSize = 0;

    // Core candidates: starts empty, seeded from genome 0, then only ever shrinks.
    let coreCandidates = null; // Int32Array, first `coreLen` entries valid
    let coreLen = 0;

    for (let k = 0; k < n; k++) {
      const genomeIdx = order[k];
      const present = presentGroupsPerGenome[genomeIdx];
      version++;
      for (let i = 0; i < present.length; i++) {
        const g = present[i];
        presentMark[g] = version;
        if (!seenAny[g]) { seenAny[g] = 1; pangenomeSize++; }
      }

      if (k === 0) {
        coreCandidates = Int32Array.from(present);
        coreLen = coreCandidates.length;
      } else {
        let write = 0;
        for (let read = 0; read < coreLen; read++) {
          const g = coreCandidates[read];
          if (presentMark[g] === version) coreCandidates[write++] = g;
        }
        coreLen = write;
      }

      pangenomeSums[k] += pangenomeSize;
      pangenomeSumsSq[k] += pangenomeSize * pangenomeSize;
      coreSums[k] += coreLen;
      coreSumsSq[k] += coreLen * coreLen;
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
