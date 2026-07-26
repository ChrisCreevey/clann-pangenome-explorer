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
