// frequency.js — frequency-class assignment and the frequency spectrum,
// the single most informative pangenome plot (build brief §6, Phase 2).

import { presenceVector } from "../parse/matrix.js";

export const DEFAULT_THRESHOLDS = { core: 99, softcore: 95, shell: 15 };

/**
 * Assign freqClass ('core' | 'softcore' | 'shell' | 'cloud') to every group
 * from its presence percentage across genomes, and recompute each genome's
 * coreGenesPresent count. Mutates and returns `data`.
 * TODO: confirm whether thresholds should persist across sessions
 * (localStorage) — currently session-only (build brief §9a).
 */
export function assignFrequencyClasses(data, thresholds = DEFAULT_THRESHOLDS) {
  const genomeCount = data.meta.genomeCount;
  data.meta.freqClassThresholds = thresholds;

  for (const g of data.groups) {
    const pct = genomeCount > 0 ? (g.genomesPresentIn / genomeCount) * 100 : 0;
    if (pct >= thresholds.core) g.freqClass = "core";
    else if (pct >= thresholds.softcore) g.freqClass = "softcore";
    else if (pct >= thresholds.shell) g.freqClass = "shell";
    else g.freqClass = "cloud";
  }

  const coreCounts = new Uint32Array(genomeCount);
  for (const g of data.groups) {
    if (g.freqClass !== "core") continue;
    const vector = presenceVector(data, g.groupIndex);
    for (let i = 0; i < genomeCount; i++) if (vector[i] > 0) coreCounts[i]++;
  }
  for (const genome of data.genomes) genome.coreGenesPresent = coreCounts[genome.index];

  return data;
}

const MIN_GAP = 1; // minimum percentage-point separation enforced between adjacent thresholds

/**
 * Adjust {core, softcore, shell} thresholds after the user edits one of
 * them by `key`, cascading any lower boundary down so it stays strictly
 * below the one(s) above it — the user only ever directly sets the
 * threshold they touched; thresholds below it move out of the way rather
 * than the edit being rejected. Values are clamped to [0, 100] and
 * rounded to whole percentage points (matching the default 99/95/15
 * convention). Returns a new thresholds object; does not mutate `prev`.
 */
export function adjustThresholds(prev, key, rawValue) {
  const value = Math.max(0, Math.min(100, Math.round(rawValue)));
  const next = { ...prev, [key]: value };

  if (key === "core" || key === "softcore") {
    if (next.softcore >= next.core) next.softcore = Math.max(0, next.core - MIN_GAP);
  }
  if (next.shell >= next.softcore) next.shell = Math.max(0, next.softcore - MIN_GAP);

  return next;
}

/** Group counts by frequency class, in a fixed display order. */
export function frequencyClassCounts(data) {
  const counts = { core: 0, softcore: 0, shell: 0, cloud: 0 };
  for (const g of data.groups) counts[g.freqClass] = (counts[g.freqClass] || 0) + 1;
  return counts;
}

/**
 * Gene frequency spectrum: for each genome count 1..N, how many groups are
 * present in exactly that many genomes. Index 0 of the returned array
 * corresponds to "present in 1 genome".
 */
export function frequencySpectrum(data) {
  const genomeCount = data.meta.genomeCount;
  const spectrum = new Array(genomeCount).fill(0);
  for (const g of data.groups) {
    if (g.genomesPresentIn >= 1) spectrum[g.genomesPresentIn - 1]++;
  }
  return spectrum;
}
