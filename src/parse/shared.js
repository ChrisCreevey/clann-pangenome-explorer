// shared.js — small parsing helpers used by every format-specific parser.
// Kept separate from index.js to avoid a circular import (index.js imports
// each format parser, and the format parsers need these helpers too).

export class ColumnMappingNeeded extends Error {
  constructor(message, { previewRows, previewHeader } = {}) {
    super(message);
    this.name = "ColumnMappingNeeded";
    this.previewRows = previewRows || [];
    this.previewHeader = previewHeader || [];
  }
}

/** Split a CSV/TSV line respecting quoted fields, for either delimiter. */
export function splitDelimited(line, delimiter) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { fields.push(cur); cur = ""; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

export function detectDelimiter(firstLine) {
  return firstLine.includes("\t") ? "\t" : ",";
}

/**
 * Parse one matrix cell into { copyCount, geneIds }. Handles a blank cell,
 * a plain 0/1 or copy-count number, and Roary/Panaroo-style
 * comma-separated gene ID lists (allele calls use ';' as an inner
 * separator and are also split here).
 */
export function parsePresenceCell(value) {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { copyCount: 0, geneIds: [] };
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return { copyCount: n, geneIds: [] };
  }
  // Fast path: the overwhelming majority of gene-ID cells are a single ID
  // with no ',' or ';' — split()/map()/filter() would still allocate three
  // throwaway arrays for that case, which adds up fast across millions of
  // cells (this was a measurable share of a large Roary matrix's peak
  // memory during streaming). Skip straight to a one-element result.
  if (!/[,;]/.test(trimmed)) return { copyCount: 1, geneIds: [trimmed] };
  const geneIds = trimmed.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return { copyCount: geneIds.length, geneIds };
}
