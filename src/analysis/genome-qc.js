// genome-qc.js — descriptive per-genome QC flagging (build brief §6: the
// per-genome gene-count bar chart is "a basic QC signal for spotting a
// problem genome" — poor assembly, wrong species, contamination — but
// today that meant eyeballing the chart for an outlier bar). Flags two
// distinct failure modes, both purely descriptive comparisons against the
// population median (no formal statistical test, consistent with the rest
// of the tool — odds ratio, not p-values):
//
//   - low core-gene coverage: a genome missing a large share of the core
//     genome relative to the rest of the population — a poor assembly or
//     the wrong species entirely.
//   - high unique-gene count: a genome carrying far more singleton
//     (present-nowhere-else) genes than the rest of the population — a
//     classic contamination signature, since the real genome's own core is
//     often still intact while extra contaminating DNA inflates this count.
//
// Median (not mean) is the reference point deliberately: it isn't dragged
// around by the very outliers this is trying to detect the way a mean is.

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const DEFAULT_QC_THRESHOLDS = {
  lowCorePct: 90, // flag when coreGenesPresent falls below this % of the population median
  highUniqueMultiplier: 3, // flag when uniqueGenes exceeds this multiple of the population median
};

/**
 * Flag genomes whose core-gene coverage or unique-gene count deviates from
 * the rest of the population by more than `thresholds` allows. Returns one
 * entry per flagged genome (not every genome) so the caller doesn't have to
 * filter — each entry lists which rule(s) it tripped and the actual values
 * behind that call, so the reason is always visible alongside the flag,
 * not just an unexplained highlighted bar.
 */
export function flagGenomeOutliers(genomes, thresholds = DEFAULT_QC_THRESHOLDS) {
  if (!genomes.length) return { flagged: [], medianCore: 0, medianUnique: 0 };

  const medianCore = median(genomes.map((g) => g.coreGenesPresent));
  const medianUnique = median(genomes.map((g) => g.uniqueGenes));
  const lowCoreCutoff = medianCore * (thresholds.lowCorePct / 100);
  const highUniqueCutoff = medianUnique * thresholds.highUniqueMultiplier;

  const flagged = [];
  for (const genome of genomes) {
    const reasons = [];
    // medianCore > 0 guard: a population with no core genes at all (or
    // vanishingly few) would otherwise make every genome trivially "below
    // the cutoff" — a degenerate case this rule shouldn't fire on.
    if (medianCore > 0 && genome.coreGenesPresent < lowCoreCutoff) {
      reasons.push({ type: "lowCore", value: genome.coreGenesPresent, median: medianCore, cutoff: lowCoreCutoff });
    }
    // Same guard for medianUnique === 0 — otherwise any genome with even
    // one unique gene would trip a "3x zero" cutoff.
    if (medianUnique > 0 && genome.uniqueGenes > highUniqueCutoff) {
      reasons.push({ type: "highUnique", value: genome.uniqueGenes, median: medianUnique, cutoff: highUniqueCutoff });
    }
    if (reasons.length) flagged.push({ genome, reasons });
  }
  return { flagged, medianCore, medianUnique };
}

/** One-line human-readable explanation for a single flag reason, for the summary list / tooltips. */
export function describeQcReason(reason) {
  if (reason.type === "lowCore") {
    return `core genes present: ${reason.value} (population median ${Math.round(reason.median)}, below ${((reason.cutoff / reason.median) * 100).toFixed(0)}%)`;
  }
  return `unique genes: ${reason.value} (population median ${Math.round(reason.median)}, above ${(reason.cutoff / reason.median).toFixed(1)}×)`;
}
