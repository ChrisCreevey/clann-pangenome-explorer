// genome-export.js — CSV export for genome-level views (currently just the
// QC-flag table; a natural home for any future genome-oriented export,
// mirroring group-export.js on the other axis).

import { toDelimited } from "./csv-util.js";

export const GENOME_QC_EXPORT_FILENAME = "genome-qc-flags.csv";

/** flagged is analysis/genome-qc.js's flagGenomeOutliers().flagged. */
export function genomeQcFlagsCsv(flagged, delimiter = ",") {
  const header = ["genome", "issues", "core_genes_present", "unique_genes", "population_median_core", "population_median_unique", "severity"];
  const rows = flagged.map(({ genome, reasons, severity }) => [
    genome.name,
    reasons.map((r) => r.type).join(";"),
    genome.coreGenesPresent,
    genome.uniqueGenes,
    reasons.find((r) => r.type === "lowCore")?.median ?? "",
    reasons.find((r) => r.type === "highUnique")?.median ?? "",
    severity.toFixed(2),
  ]);
  return toDelimited(header, rows, delimiter);
}
