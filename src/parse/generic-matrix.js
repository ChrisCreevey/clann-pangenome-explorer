// generic-matrix.js — fallback CSV/TSV importer for any pangenome matrix that
// doesn't match Roary/Panaroo, PIRATE, or PanACoTA's recognisable shapes.
// Never guesses silently: if the group-ID column and genome columns aren't
// unambiguous, throws ColumnMappingNeeded with a preview so the caller can
// show a confirmation UI (mirrors clann-blast-explorer's headerless-file handling).

import { ColumnMappingNeeded, splitDelimited, detectDelimiter, parsePresenceCell } from "./shared.js";

const PREVIEW_ROWS = 8;

function looksNumericColumn(rows, colIndex) {
  let seen = 0;
  for (const row of rows) {
    const v = (row[colIndex] ?? "").trim();
    if (v === "") continue;
    seen++;
    if (!/^\d+(\.\d+)?$/.test(v) && !/^[\w.\-]+(,[\w.\-]+)*$/.test(v)) return false;
  }
  return seen > 0;
}

function looksLikeGroupIdColumn(rows, colIndex) {
  const seen = new Set();
  let allNumeric = true;
  for (const row of rows) {
    const v = (row[colIndex] ?? "").trim();
    if (v === "" || seen.has(v)) return false;
    seen.add(v);
    if (!/^\d+(\.\d+)?$/.test(v)) allNumeric = false;
  }
  // A column of small numbers (0/1, copy counts) is a genome column, not an
  // ID column, even though its values happen to be unique in a tiny sample.
  return !allNumeric;
}

/**
 * @param {string} text
 * @param {{ groupIdColumn?: number, genomeColumns?: number[] }} opts
 *   When groupIdColumn/genomeColumns are supplied (from a confirmed manual
 *   mapping), they're used directly and ambiguity checks are skipped.
 */
export function parseGenericMatrix(text, opts = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("File has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const dataLines = lines.slice(1);
  const rows = dataLines.map((l) => splitDelimited(l, delimiter));
  const colCount = header.length;

  let groupIdColumn = opts.groupIdColumn;
  let genomeColumns = opts.genomeColumns;

  if (groupIdColumn === undefined || genomeColumns === undefined) {
    const sample = rows.slice(0, Math.min(50, rows.length));
    const candidateIdCols = [];
    for (let c = 0; c < colCount; c++) if (looksLikeGroupIdColumn(sample, c)) candidateIdCols.push(c);

    if (candidateIdCols.length !== 1) {
      throw new ColumnMappingNeeded(
        "Couldn't unambiguously identify which column holds the gene-group ID.",
        { previewHeader: header, previewRows: rows.slice(0, PREVIEW_ROWS) }
      );
    }
    groupIdColumn = candidateIdCols[0];
    genomeColumns = [];
    for (let c = 0; c < colCount; c++) {
      if (c === groupIdColumn) continue;
      if (!looksNumericColumn(sample, c)) {
        throw new ColumnMappingNeeded(
          `Column "${header[c]}" doesn't look like a genome presence/absence column.`,
          { previewHeader: header, previewRows: rows.slice(0, PREVIEW_ROWS) }
        );
      }
      genomeColumns.push(c);
    }
  }

  const genomeNames = genomeColumns.map((c) => header[c]);
  const groups = rows.map((row) => {
    const groupId = row[groupIdColumn];
    const cells = {};
    genomeColumns.forEach((c, i) => {
      cells[genomeNames[i]] = parsePresenceCell(row[c]);
    });
    return { groupId, representativeId: groupId, annotation: null, cells };
  });

  return { genomeNames, groups };
}
