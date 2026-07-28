// pair-export.js — filtered CoinFinder pair table export (build brief §7),
// e.g. "all cross-category associations above a chosen significance
// threshold", for direct use in a report.

import { toDelimited } from "./csv-util.js";
import { categoryFor } from "../src/analysis/pairs.js";

const PAIR_COLUMNS = ["groupIdA", "categoryA", "freqClassA", "annotationA", "direction", "significance", "groupIdB", "categoryB", "freqClassB", "annotationB"];
const PAIR_HEADER = ["group_id_a", "category_a", "freq_class_a", "annotation_a", "direction", "significance", "group_id_b", "category_b", "freq_class_b", "annotation_b"];

function pairColumnValue(pair, col) {
  switch (col) {
    case "groupIdA": return pair.groupIdA;
    case "groupIdB": return pair.groupIdB;
    case "categoryA": return categoryFor(pair.resolvedA);
    case "categoryB": return categoryFor(pair.resolvedB);
    case "freqClassA": return pair.resolvedA.freqClass;
    case "freqClassB": return pair.resolvedB.freqClass;
    case "annotationA": return pair.resolvedA.annotation;
    case "annotationB": return pair.resolvedB.annotation;
    case "direction": return pair.direction;
    case "significance": return pair.significance;
    default:
      // dynamic "ann_<sourceKey>A"/"ann_<sourceKey>B" columns — the group's
      // own flattened property (set by parse/annotation.js) minus the
      // trailing side letter.
      if (col.endsWith("A")) return pair.resolvedA[col.slice(0, -1)];
      if (col.endsWith("B")) return pair.resolvedB[col.slice(0, -1)];
      return undefined;
  }
}

/**
 * Pair table export — matches the in-app "Association / disassociation
 * pairs" card's columns, including one column per side (A/B) for the
 * matrix's own annotation plus every uploaded annotation source
 * (`data.meta.annotationSources`), so the exported table is a
 * self-contained "which annotated genes associate/disassociate" report,
 * summarisable outside the app without a separate lookup against the
 * Groups table.
 */
export function pairsToDelimited(data, pairs, delimiter = ",") {
  const columns = [...PAIR_COLUMNS];
  const header = [...PAIR_HEADER];
  for (const source of data.meta.annotationSources || []) {
    columns.push(`ann_${source.key}A`, `ann_${source.key}B`);
    header.push(`${source.header} A`, `${source.header} B`);
  }
  const rows = pairs.map((p) => columns.map((col) => pairColumnValue(p, col)));
  return toDelimited(header, rows, delimiter);
}

// source/target/interaction is Cytoscape's own network-table convention
// (the SIF column order) — importing this file via File > Import > Network
// from Table needs no column remapping. Associated and disassociated pairs
// are listed together, distinguished by `interaction`, so the split (or
// not) between them is a decision made in Cytoscape, not baked into the
// export — this always reflects the full current filter selection, not
// whatever subset the in-app network view is currently capped to drawing.
const EDGE_TABLE_HEADER = [
  "source", "target", "interaction", "significance",
  "source_category", "target_category",
  "source_freq_class", "target_freq_class",
  "source_annotation", "target_annotation",
  "source_tags", "target_tags",
];

export function pairsToCytoscapeEdgeTable(pairs, delimiter = ",") {
  const rows = pairs.map((p) => [
    p.groupIdA, p.groupIdB, p.direction, p.significance,
    categoryFor(p.resolvedA), categoryFor(p.resolvedB),
    p.resolvedA.freqClass, p.resolvedB.freqClass,
    p.resolvedA.annotation, p.resolvedB.annotation,
    p.resolvedA.tags.join(";"), p.resolvedB.tags.join(";"),
  ]);
  return toDelimited(EDGE_TABLE_HEADER, rows, delimiter);
}
