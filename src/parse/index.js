// index.js — detectFormat() + parse(): turns an uploaded pangenome matrix
// (Roary, Panaroo, PIRATE, PanACoTA, or a generic CSV/TSV) into PangenomeData.
//
// PangenomeData is the single internal shape every renderer consumes (see
// build brief §4). Format-specific parsers only need to return a raw shape
// of { genomeNames, groups: [{ groupId, representativeId, annotation, rawRow }] }
// (rawRow = unparsed per-genome cell text, aligned to genomeNames) — this
// module builds the typed-array presence matrix and derives every
// per-group/per-genome stat on top of it (see matrix.js for why: storing
// presence as a flat Uint16Array instead of one object per cell is what
// makes 10,000-genome-scale studies feasible in a browser tab).

import { parseRoary, parseRoaryStream, looksLikeRoary } from "./roary.js";
import { parsePirate, looksLikePirate } from "./pirate.js";
import { parsePanacota, looksLikePanacota } from "./panacota.js";
import { parseGenericMatrix } from "./generic-matrix.js";
import { ColumnMappingNeeded, splitDelimited, detectDelimiter, parsePresenceCell } from "./shared.js";
import { buildMatrix, rowView } from "./matrix.js";
import { assignFrequencyClasses, DEFAULT_THRESHOLDS } from "../analysis/frequency.js";

export { ColumnMappingNeeded, splitDelimited, detectDelimiter, parsePresenceCell, assignFrequencyClasses };

/**
 * Best-guess the format from filename and header shape. Returns one of
 * 'roary' | 'pirate' | 'panacota' | 'generic-matrix'.
 */
export function detectFormat(filename, text) {
  const name = (filename || "").toLowerCase();
  // match, not split(text, 1): split still scans/copies the whole string
  // looking for further separators on huge files; match stops at the first hit.
  const firstLine = (text.match(/^[^\r\n]*/) || [""])[0];
  const delimiter = detectDelimiter(firstLine);
  const header = splitDelimited(firstLine, delimiter);

  if (name.includes("pirate") || looksLikePirate(header)) return "pirate";
  if (name.includes("gene_presence_absence") || looksLikeRoary(header)) return "roary";
  if (looksLikePanacota(header)) return "panacota";
  return "generic-matrix";
}

/**
 * Parse uploaded matrix text (and optional manual column mapping) into PangenomeData.
 * @param {string} text
 * @param {{ filename?: string, format?: string, groupIdColumn?: number, genomeColumns?: number[] }} opts
 */
export function parse(text, opts = {}) {
  const format = opts.format || detectFormat(opts.filename, text);
  let raw;
  if (format === "roary") raw = parseRoary(text);
  else if (format === "pirate") raw = parsePirate(text);
  else if (format === "panacota") raw = parsePanacota(text);
  else raw = parseGenericMatrix(text, opts);

  return buildPangenomeData(raw, { sourceFilename: opts.filename, format });
}

/**
 * Same as parse(), but for a Roary/Panaroo matrix read via stream-lines.js
 * instead of a fully-materialised text string — for files too large to
 * safely hold as one JS string. Format must already be known to be 'roary'
 * (callers detect this cheaply via peekFirstLine before choosing this path).
 * parseRoaryStream already builds presenceMatrix/geneIdsByGroup directly
 * (see matrix.js's StreamingMatrixBuilder), so this skips buildMatrix and
 * goes straight to assembling the rest of PangenomeData around them.
 */
export async function parseRoaryFromLines(lineIterator, opts = {}) {
  const raw = await parseRoaryStream(lineIterator, { onProgress: opts.onProgress });
  return assemblePangenomeData(raw.genomeNames, raw.groupsMeta, raw.presenceMatrix, raw.geneIdsByGroup, {
    sourceFilename: opts.filename,
    format: "roary",
  });
}

/** Turn a raw { genomeNames, groups } shape into full PangenomeData with derived stats. */
export function buildPangenomeData(raw, meta = {}) {
  const genomeCount = raw.genomeNames.length;
  const { presenceMatrix, geneIdsByGroup } = buildMatrix(raw.groups, genomeCount);
  return assemblePangenomeData(raw.genomeNames, raw.groups, presenceMatrix, geneIdsByGroup, meta);
}

/**
 * Shared tail end of both parse paths above: given genome names, one
 * { groupId, representativeId, annotation } record per group (rawRow, if
 * present, is ignored here — it was already consumed to build the matrix),
 * and the finished presence matrix/gene-ID store, derive every per-group
 * and per-genome stat PangenomeData needs.
 */
function assemblePangenomeData(genomeNames, groupsMeta, presenceMatrix, geneIdsByGroup, meta = {}) {
  const genomeCount = genomeNames.length;
  const groupCount = groupsMeta.length;

  const genomeTotals = genomeNames.map(() => ({ totalGenes: 0, uniqueGenes: 0, coreGenesPresent: 0 }));

  const groups = groupsMeta.map((g, groupIndex) => {
    const row = rowView(presenceMatrix, groupIndex, genomeCount);
    let genomesPresentIn = 0;
    let sequencesTotal = 0;
    for (let genomeIndex = 0; genomeIndex < genomeCount; genomeIndex++) {
      const copyCount = row[genomeIndex];
      if (copyCount > 0) genomesPresentIn++;
      sequencesTotal += copyCount;
    }
    return {
      groupId: g.groupId,
      representativeId: g.representativeId ?? g.groupId,
      annotation: g.annotation ?? null,
      annotationColumns: {},
      tags: [],
      freqClass: null,
      genomesPresentIn,
      sequencesTotal,
      avgCopiesPerGenome: genomesPresentIn > 0 ? sequencesTotal / genomesPresentIn : 0,
      groupIndex,
    };
  });

  for (const g of groups) {
    const row = rowView(presenceMatrix, g.groupIndex, genomeCount);
    for (let genomeIndex = 0; genomeIndex < genomeCount; genomeIndex++) {
      const copyCount = row[genomeIndex];
      if (copyCount <= 0) continue;
      const totals = genomeTotals[genomeIndex];
      totals.totalGenes += copyCount;
      if (g.genomesPresentIn === 1) totals.uniqueGenes += copyCount;
    }
  }

  const genomes = genomeNames.map((name, index) => ({ name, index, ...genomeTotals[index] }));
  const genomeNameToIndex = new Map(genomes.map((genome) => [genome.name, genome.index]));

  const data = {
    meta: {
      sourceFilename: meta.sourceFilename ?? null,
      format: meta.format ?? null,
      genomeCount,
      groupCount,
      freqClassThresholds: { ...DEFAULT_THRESHOLDS },
      annotationSources: [],
    },
    genomes,
    genomeNameToIndex,
    groups,
    presenceMatrix,
    geneIdsByGroup,
    pairs: [],
    unmatchedPairs: [],
  };

  assignFrequencyClasses(data, data.meta.freqClassThresholds);
  return data;
}
