// index.js — detectFormat() + parse(): turns an uploaded pangenome matrix
// (Roary, Panaroo, PIRATE, PanACoTA, or a generic CSV/TSV) into PangenomeData.
//
// PangenomeData is the single internal shape every renderer consumes (see
// build brief §4). Format-specific parsers only need to return a raw shape
// of { genomeNames, groups: [{ groupId, representativeId, annotation, cells }] }
// — this module derives every per-group and per-genome stat on top of that.

import { parseRoary, looksLikeRoary } from "./roary.js";
import { parsePirate, looksLikePirate } from "./pirate.js";
import { parsePanacota, looksLikePanacota } from "./panacota.js";
import { parseGenericMatrix } from "./generic-matrix.js";
import { ColumnMappingNeeded, splitDelimited, detectDelimiter, parsePresenceCell } from "./shared.js";
import { assignFrequencyClasses, DEFAULT_THRESHOLDS } from "../analysis/frequency.js";

export { ColumnMappingNeeded, splitDelimited, detectDelimiter, parsePresenceCell, assignFrequencyClasses };

/**
 * Best-guess the format from filename and header shape. Returns one of
 * 'roary' | 'pirate' | 'panacota' | 'generic-matrix'.
 */
export function detectFormat(filename, text) {
  const name = (filename || "").toLowerCase();
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
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

/** Turn a raw { genomeNames, groups } shape into full PangenomeData with derived stats. */
export function buildPangenomeData(raw, meta = {}) {
  const genomeNames = raw.genomeNames;
  const genomeTotals = new Map(genomeNames.map((g) => [g, { totalGenes: 0, uniqueGenes: 0, coreGenesPresent: 0 }]));

  const groups = raw.groups.map((g) => {
    let genomesPresentIn = 0;
    let sequencesTotal = 0;
    for (const name of genomeNames) {
      const cell = g.cells[name];
      const copyCount = cell ? cell.copyCount : 0;
      if (copyCount > 0) genomesPresentIn++;
      sequencesTotal += copyCount;
    }
    return {
      groupId: g.groupId,
      representativeId: g.representativeId ?? g.groupId,
      annotation: g.annotation ?? null,
      consensusAnnotation: g.consensusAnnotation ?? null,
      consistencyScore: g.consistencyScore ?? null,
      annotationBreakdown: g.annotationBreakdown ?? null,
      tags: [],
      freqClass: null,
      genomesPresentIn,
      sequencesTotal,
      avgCopiesPerGenome: genomesPresentIn > 0 ? sequencesTotal / genomesPresentIn : 0,
      cells: g.cells,
    };
  });

  for (const g of groups) {
    for (const name of genomeNames) {
      const cell = g.cells[name];
      const copyCount = cell ? cell.copyCount : 0;
      if (copyCount <= 0) continue;
      const totals = genomeTotals.get(name);
      totals.totalGenes += copyCount;
      if (g.genomesPresentIn === 1) totals.uniqueGenes += copyCount;
    }
  }

  const genomes = genomeNames.map((name) => ({ name, ...genomeTotals.get(name) }));

  const data = {
    meta: {
      sourceFilename: meta.sourceFilename ?? null,
      format: meta.format ?? null,
      genomeCount: genomeNames.length,
      groupCount: groups.length,
      freqClassThresholds: { ...DEFAULT_THRESHOLDS },
      annotationWorkflow: null,
    },
    genomes,
    groups,
    pairs: [],
    unmatchedPairs: [],
  };

  assignFrequencyClasses(data, data.meta.freqClassThresholds);
  return data;
}
