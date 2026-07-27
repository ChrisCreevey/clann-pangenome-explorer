// roary.js — Roary's gene_presence_absence.csv, also covers Panaroo's
// Roary-compatible gene_presence_absence.csv / gene_presence_absence_roary.csv
// (near-identical column set, minor naming differences).

import { splitDelimited, detectDelimiter } from "./shared.js";

// Fixed metadata columns preceding the per-genome columns. Panaroo's naming
// differs slightly ("Non-unique Gene name" vs "Non-unique gene name" etc.)
// so this is matched case-insensitively and isn't relied on for anything
// beyond "how many leading columns are metadata, not genomes".
const METADATA_COLUMN_PATTERNS = [
  /^gene$/i,
  /^non-unique gene name$/i,
  /^annotation$/i,
  /^no\. isolates$/i,
  /^no\. sequences$/i,
  /^avg sequences per isolate$/i,
  /^genome fragment$/i,
  /^order within fragment$/i,
  /^accessory fragment$/i,
  /^accessory order with fragment$/i,
  /^qc$/i,
  /^min group size nuc$/i,
  /^max group size nuc$/i,
  /^avg group size nuc$/i,
];

export function looksLikeRoary(header) {
  const first = (header[0] || "").trim().toLowerCase();
  const second = (header[1] || "").trim().toLowerCase();
  return first === "gene" && second.startsWith("non-unique");
}

function countLeadingMetadataColumns(header) {
  let count = 0;
  for (const col of header) {
    const trimmed = col.trim();
    if (METADATA_COLUMN_PATTERNS.some((re) => re.test(trimmed))) count++;
    else break;
  }
  return Math.max(count, 1); // at minimum, "Gene" itself is metadata
}

export function parseRoary(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("Roary file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const metaColCount = countLeadingMetadataColumns(header);
  const genomeNames = header.slice(metaColCount);
  const annotationIdx = header.findIndex((h) => /^annotation$/i.test(h.trim()));

  const groups = lines.slice(1).map((line) => {
    const row = splitDelimited(line, delimiter);
    const groupId = row[0];
    const annotation = annotationIdx >= 0 ? (row[annotationIdx] || null) : null;
    const rawRow = row.slice(metaColCount, metaColCount + genomeNames.length);
    return { groupId, representativeId: groupId, annotation, rawRow };
  });

  return { genomeNames, groups };
}
