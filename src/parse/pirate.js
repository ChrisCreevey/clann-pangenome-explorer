// pirate.js — PIRATE.gene_families.tsv. PIRATE reports allele-level calls
// per genome rather than raw gene IDs; this module is the only place that
// needs to know that — it rolls allele calls up into the same
// { copyCount, geneIds } cell shape every other parser produces, so nothing
// downstream has to special-case PIRATE.
//
// Column layout: a block of family-level metadata columns ending in
// "threshold%", followed by one column per genome holding that genome's
// allele call(s) for the family (blank if absent, ';'-separated if the
// family has multiple alleles/copies in that genome).

import { splitDelimited, detectDelimiter, parsePresenceCell } from "./shared.js";

export function looksLikePirate(header) {
  return header.some((h) => /^threshold%?$/i.test(h.trim()));
}

export function parsePirate(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("PIRATE file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);

  const thresholdIdx = header.findIndex((h) => /^threshold%?$/i.test(h.trim()));
  if (thresholdIdx < 0) throw new Error('PIRATE file is missing the "threshold%" column used to locate the per-genome columns.');
  const metaColCount = thresholdIdx + 1;
  const genomeNames = header.slice(metaColCount);

  const groupIdx = header.findIndex((h) => /^gene_family$/i.test(h.trim()));
  const consensusIdx = header.findIndex((h) => /^consensus_gene_name$/i.test(h.trim()));
  const productIdx = header.findIndex((h) => /^product$/i.test(h.trim()));

  const groups = lines.slice(1).map((line) => {
    const row = splitDelimited(line, delimiter);
    const groupId = groupIdx >= 0 ? row[groupIdx] : row[0];
    const annotation = (productIdx >= 0 && row[productIdx]) || (consensusIdx >= 0 && row[consensusIdx]) || null;
    const cells = {};
    genomeNames.forEach((name, i) => {
      cells[name] = parsePresenceCell(row[metaColCount + i]);
    });
    return { groupId, representativeId: groupId, annotation, cells };
  });

  return { genomeNames, groups };
}
