// genome-metadata.js — import per-genome metadata/phenotype columns (e.g.
// resistant/susceptible, host species, isolation source), keyed by genome
// name rather than gene group ID. Mirrors annotation.js's one-source-per-
// column bookkeeping (data.meta.annotationSources / group.annotationColumns)
// but on the genome axis: data.meta.phenotypeSources / genome.phenotypes.
//
// One upload can add several phenotype columns at once — every column
// except the genome-ID column becomes its own registered source, since a
// typical metadata/sample-sheet file carries more than one trait per genome
// (resistance status, host, region, ...) in one file.

import { splitDelimited, detectDelimiter, ColumnMappingNeeded } from "./shared.js";

const ID_NAME_RE = /genome|isolate|sample|strain|accession|name|^id$/i;

function parseRows(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("Genome metadata file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitDelimited(l, delimiter));
  return { header, rows };
}

function idMatchRate(rows, colIndex, genomeNames, sample = 200) {
  const values = rows.slice(0, sample).map((r) => r[colIndex]);
  const hits = values.filter((v) => genomeNames.has(v)).length;
  return values.length ? hits / values.length : 0;
}

/**
 * Best-guess the genome-ID column: highest match rate against loaded genome
 * names wins outright (>= 30% of a sample matching is a strong signal);
 * a name-based heuristic is the fallback for a small file too short for
 * the match-rate check to be reliable. Throws ColumnMappingNeeded — same
 * mechanism used by the CoinFinder/generic-matrix importers — when neither
 * clears the bar, rather than silently guessing wrong.
 */
function guessIdColumn(header, rows, data) {
  const genomeNames = new Set(data.genomes.map((g) => g.name));
  const byMatch = header
    .map((_, i) => ({ i, rate: idMatchRate(rows, i, genomeNames) }))
    .sort((a, b) => b.rate - a.rate);
  if (byMatch[0] && byMatch[0].rate >= 0.3) return byMatch[0].i;
  const byName = header.findIndex((h) => ID_NAME_RE.test(h.trim()));
  if (byName >= 0) return byName;
  throw new ColumnMappingNeeded(
    "Couldn't identify a genome-ID column matching your loaded genomes.",
    { previewHeader: header, previewRows: rows.slice(0, 8) }
  );
}

function registerPhenotypeSource(data, header) {
  const sources = data.meta.phenotypeSources;
  const existingHeaders = new Set(sources.map((s) => s.header));
  const label = header || "Phenotype";
  let uniqueLabel = label, n = 2;
  while (existingHeaders.has(uniqueLabel)) { uniqueLabel = `${label} (${n})`; n++; }
  const source = { key: `pheno${sources.length + 1}_${Date.now().toString(36)}_${n}`, header: uniqueLabel, matched: 0, unmatchedIds: [], distinctValues: [] };
  sources.push(source);
  return source;
}

/**
 * Import a genome-ID + one-or-more-phenotype-value file. Every column
 * except the ID column becomes its own registered phenotype source
 * (data.meta.phenotypeSources), with per-genome values recorded in
 * genome.phenotypes[key].
 *
 * A blank cell is left unset in genome.phenotypes (not stored as ""), so a
 * genome with no value for a column is correctly excluded from any
 * comparison built against that column, rather than silently matching an
 * empty-string "level". A genome ID that doesn't match any loaded genome
 * skips that whole row (all its columns), tracked once in unmatchedIds
 * rather than per column, since one bad ID is one bad row.
 *
 * @param {import("./index.js").PangenomeData} data
 * @param {string} text
 * @param {{ idCol?: number }} opts manual column override, for the
 *   ColumnMappingNeeded retry path
 * @returns {{ matched: number, unmatchedIds: string[], sources: Array<{key,header,matched,unmatchedIds,distinctValues}> }}
 *   `matched` / top-level `unmatchedIds` describe row-level ID resolution;
 *   each source's own `matched` counts genomes with a non-blank value for
 *   that specific column, which can be lower than the row-level total.
 */
export function applyGenomeMetadata(data, text, opts = {}) {
  const { header, rows } = parseRows(text);
  const idCol = opts.idCol !== undefined ? opts.idCol : guessIdColumn(header, rows, data);

  const valueCols = header.map((_, i) => i).filter((i) => i !== idCol);
  if (!valueCols.length) {
    throw new Error("Genome metadata file has an ID column but no phenotype/value columns to import.");
  }

  const byName = new Map(data.genomes.map((g) => [g.name, g]));
  const sources = valueCols.map((colIndex) => ({ colIndex, source: registerPhenotypeSource(data, header[colIndex]) }));

  const unmatchedIds = [];
  let matched = 0;

  for (const row of rows) {
    const genomeId = row[idCol];
    const genome = byName.get(genomeId);
    if (!genome) { unmatchedIds.push(genomeId); continue; }
    matched++;
    for (const { colIndex, source } of sources) {
      const raw = (row[colIndex] ?? "").trim();
      if (raw === "") continue; // no value for this genome/column — leave unset, not ""
      genome.phenotypes[source.key] = raw;
      source.matched++;
      if (!source.distinctValues.includes(raw)) source.distinctValues.push(raw);
    }
  }

  for (const { source } of sources) {
    source.unmatchedIds = unmatchedIds;
    source.distinctValues.sort();
  }

  return { matched, unmatchedIds, sources: sources.map((s) => s.source) };
}
