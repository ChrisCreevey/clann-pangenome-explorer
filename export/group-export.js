// group-export.js — staging data for downstream work (build brief §7):
// constituent gene ID lists for sequence extraction, a filtered-groups
// table export, and the multi-copy/gene-family candidate export that
// feeds into Clann's multi-copy supertree step.

import { toDelimited } from "./csv-util.js";
import { allGeneIdsForGroup, geneIdsByGenomeForGroup } from "../src/parse/matrix.js";

/**
 * Flat, one-ID-per-line list of every constituent gene ID across every
 * genome for the given groups — ready to hand to a FASTA/GFF extraction
 * step (build brief §7). Sorted for a deterministic, diffable file.
 */
export function geneIdListText(data, groups) {
  const ids = new Set();
  for (const group of groups) {
    for (const geneId of allGeneIdsForGroup(data, group.groupIndex)) ids.add(geneId);
  }
  return [...ids].sort().join("\n") + (ids.size ? "\n" : "");
}

/**
 * group_id, genome, gene_id table — the same gene IDs as geneIdListText()
 * but keeping the group/genome traceability, for cases where that context
 * matters downstream.
 */
export function geneIdTableCsv(data, groups, delimiter = ",") {
  const rows = [];
  for (const group of groups) {
    for (const [genomeName, geneIds] of geneIdsByGenomeForGroup(data, group.groupIndex)) {
      for (const geneId of geneIds) rows.push([group.groupId, genomeName, geneId]);
    }
  }
  return toDelimited(["group_id", "genome", "gene_id"], rows, delimiter);
}

const GROUP_COLUMNS = ["groupId", "annotation", "freqClass", "genomesPresentIn", "sequencesTotal", "avgCopiesPerGenome", "tags"];
const GROUP_HEADER = ["group_id", "annotation", "freq_class", "genomes_present_in", "sequences_total", "avg_copies_per_genome", "tags"];

/**
 * Generic filtered-groups table export (matches the "Filtered groups" card's
 * columns) — one column per uploaded annotation file, headed by that file's
 * own annotation-column header, plus a matched-genes count column for any
 * Workflow B source.
 */
export function groupTableCsv(data, groups, delimiter = ",") {
  const columns = [...GROUP_COLUMNS];
  const header = [...GROUP_HEADER];
  for (const source of data.meta.annotationSources || []) {
    columns.push(`ann_${source.key}`);
    header.push(source.header);
    if (source.workflow === "B") {
      columns.push(`annMatched_${source.key}`);
      header.push(`${source.header} — matched genes`);
    }
  }
  const rows = groups.map((g) => columns.map((col) => (Array.isArray(g[col]) ? g[col].join(";") : g[col])));
  return toDelimited(header, rows, delimiter);
}

/**
 * Annotation-to-association summary export (build brief §6 Phase 6,
 * "map annotations to associations"): one row per group appearing in the
 * current pair selection — every column groupTableCsv() would export
 * (matrix annotation, every uploaded annotation column, tags, frequency
 * class, isolate/sequence counts) plus associated/disassociated/total
 * counts from analysis/pairs.js's groupAssociationSummary(). `rows` is
 * that function's output (already carries associated/disassociated/total
 * spread alongside the group's own fields).
 */
export function groupAssociationSummaryCsv(data, rows, delimiter = ",") {
  const columns = [...GROUP_COLUMNS, "associated", "disassociated", "total"];
  const header = [...GROUP_HEADER, "associated", "disassociated", "total"];
  for (const source of data.meta.annotationSources || []) {
    columns.splice(columns.length - 3, 0, `ann_${source.key}`);
    header.splice(header.length - 3, 0, source.header);
    if (source.workflow === "B") {
      columns.splice(columns.length - 3, 0, `annMatched_${source.key}`);
      header.splice(header.length - 3, 0, `${source.header} — matched genes`);
    }
  }
  const dataRows = rows.map((g) => columns.map((col) => (Array.isArray(g[col]) ? g[col].join(";") : g[col])));
  return toDelimited(header, dataRows, delimiter);
}

/**
 * Multi-copy/gene-family candidate export — a feeder into Clann's
 * multi-copy supertree step (build brief §7). Filename placeholder
 * pending confirmation against Clann's own naming (build brief §9c).
 */
export const MULTICOPY_EXPORT_FILENAME = "multicopy-candidates.csv";

export function multiCopyCandidatesCsv(groups, delimiter = ",") {
  const rows = groups.map((g) => [g.groupId, g.annotation, g.freqClass, g.genomesPresentIn, g.sequencesTotal, g.avgCopiesPerGenome.toFixed(2)]);
  return toDelimited(["group_id", "annotation", "freq_class", "genomes_present_in", "sequences_total", "avg_copies_per_genome"], rows, delimiter);
}
