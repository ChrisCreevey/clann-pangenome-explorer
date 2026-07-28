// pair-export.js — filtered CoinFinder pair table export (build brief §7),
// e.g. "all cross-category associations above a chosen significance
// threshold", for direct use in a report.

import { toDelimited } from "./csv-util.js";
import { categoryFor } from "../src/analysis/pairs.js";

const HEADER = ["group_id_a", "category_a", "freq_class_a", "direction", "significance", "group_id_b", "category_b", "freq_class_b"];

export function pairsToDelimited(pairs, delimiter = ",") {
  const rows = pairs.map((p) => [
    p.groupIdA, categoryFor(p.resolvedA), p.resolvedA.freqClass,
    p.direction, p.significance,
    p.groupIdB, categoryFor(p.resolvedB), p.resolvedB.freqClass,
  ]);
  return toDelimited(HEADER, rows, delimiter);
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
