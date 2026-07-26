// panacota.js — PanACoTA pangenome matrix: families (rows) x genomes
// (columns), 0/1 or copy-count cells, no rich annotation columns. Detected
// by header shape (first column looks like a family/group ID, e.g.
// "fam_num"/"family", every other column numeric) rather than a fixed
// filename, since PanACoTA's matrix output naming varies by run.
//
// Structurally identical to the unambiguous branch of the generic-matrix
// fallback — kept as its own module so format detection can label it
// distinctly in PangenomeData.meta.format, and so a PanACoTA-specific
// quirk (e.g. a differently named ID column) has one clear place to live.

import { splitDelimited, detectDelimiter, parsePresenceCell } from "./shared.js";

export function looksLikePanacota(header) {
  const first = (header[0] || "").trim().toLowerCase();
  return /^(fam|family|fam_num|num_fam)/i.test(first);
}

export function parsePanacota(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("PanACoTA file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const genomeNames = header.slice(1);

  const groups = lines.slice(1).map((line) => {
    const row = splitDelimited(line, delimiter);
    const groupId = row[0];
    const cells = {};
    genomeNames.forEach((name, i) => {
      cells[name] = parsePresenceCell(row[i + 1]);
    });
    return { groupId, representativeId: groupId, annotation: null, cells };
  });

  return { genomeNames, groups };
}
