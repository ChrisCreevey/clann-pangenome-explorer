// frequency.js — frequency-class assignment and the frequency spectrum,
// the single most informative pangenome plot (build brief §6, Phase 2).

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

  const coreCounts = new Map(data.genomes.map((genome) => [genome.name, 0]));
  for (const g of data.groups) {
    if (g.freqClass !== "core") continue;
    for (const genome of data.genomes) {
      const cell = g.cells[genome.name];
      if (cell && cell.copyCount > 0) coreCounts.set(genome.name, coreCounts.get(genome.name) + 1);
    }
  }
  for (const genome of data.genomes) genome.coreGenesPresent = coreCounts.get(genome.name);

  return data;
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
