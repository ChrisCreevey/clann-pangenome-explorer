// roary.js — Roary's gene_presence_absence.csv, also covers Panaroo's
// Roary-compatible gene_presence_absence.csv / gene_presence_absence_roary.csv
// (near-identical column set, minor naming differences).

import { splitDelimited, detectDelimiter } from "./shared.js";
import { StreamingMatrixBuilder } from "./matrix.js";

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

/**
 * Build a one-line diagnostic for the "no data rows" case, so it's clear
 * whether this is a genuinely empty/header-only file, a file whose content
 * looks truncated (a common symptom of the browser running out of memory
 * partway through decoding a very large file), or an unrecognised line
 * ending / encoding.
 */
function diagnoseEmptyLines(text) {
  const len = text.length;
  if (len === 0) {
    return "The file content read as completely empty — the browser may have run out of memory while reading it (check DevTools' console/memory tab for an out-of-memory warning), or the upload itself is empty.";
  }
  const hasNewline = /[\r\n]/.test(text);
  const sample = JSON.stringify(text.slice(0, 120));
  if (!hasNewline) {
    return `Read ${len.toLocaleString()} characters but found no line breaks at all, so the whole file looks like one line. Sample of the start: ${sample}. This usually means an unrecognised line-ending style, or that the read was cut short before a partial line — try re-saving the file as plain CSV/UTF-8, or check whether it was truncated in transit.`;
  }
  return `Read ${len.toLocaleString()} characters, found line breaks, but only one non-empty line survived splitting — the content past the header may have been cut off. Sample of the start: ${sample}. If this file is very large, this can happen when the browser hits a memory limit partway through reading it; try a 64-bit browser with more available memory, or split the file.`;
}

function parseHeaderLine(headerLine) {
  const delimiter = detectDelimiter(headerLine);
  const header = splitDelimited(headerLine, delimiter);
  const metaColCount = countLeadingMetadataColumns(header);
  const genomeNames = header.slice(metaColCount);
  const annotationIdx = header.findIndex((h) => /^annotation$/i.test(h.trim()));
  return { delimiter, metaColCount, genomeNames, annotationIdx };
}

function parseDataLine(line, headerInfo) {
  const { delimiter, metaColCount, genomeNames, annotationIdx } = headerInfo;
  const row = splitDelimited(line, delimiter);
  const groupId = row[0];
  const annotation = annotationIdx >= 0 ? (row[annotationIdx] || null) : null;
  const rawRow = row.slice(metaColCount, metaColCount + genomeNames.length);
  return { groupId, representativeId: groupId, annotation, rawRow };
}

/** Same field extraction as parseDataLine, but keeps rawRow out of the returned object — a
 * streaming caller hands rawRow straight to a StreamingMatrixBuilder and discards it per-row,
 * rather than collecting it into an array kept alive for the whole file. */
function parseDataLineStreaming(line, headerInfo) {
  const { delimiter, metaColCount, genomeNames, annotationIdx } = headerInfo;
  const row = splitDelimited(line, delimiter);
  const groupId = row[0];
  const annotation = annotationIdx >= 0 ? (row[annotationIdx] || null) : null;
  const rawRow = row.slice(metaColCount, metaColCount + genomeNames.length);
  return { meta: { groupId, representativeId: groupId, annotation }, rawRow };
}

export function parseRoary(text) {
  // Split on \n, \r\n, or a bare \r (classic-Mac-style line endings, which
  // some export tools still produce) — a plain /\r?\n/ never matches a lone
  // \r, so a file using it collapses into a single "line" and looks empty.
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error(`Roary file has no data rows. ${diagnoseEmptyLines(text)}`);
  }
  const headerInfo = parseHeaderLine(lines[0]);
  const groups = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    groups[i - 1] = parseDataLine(lines[i], headerInfo);
  }

  return { genomeNames: headerInfo.genomeNames, groups };
}

/**
 * Same result as parseRoary, but consumes an async iterable of lines (see
 * stream-lines.js) instead of one big string, AND writes each row straight
 * into a StreamingMatrixBuilder as it arrives rather than collecting every
 * row's raw per-genome cell text into one big array first. That collection
 * step is what made the first version of this function still crash on a
 * huge file despite streaming the read: holding every row's rawRow strings
 * alive simultaneously is exactly the groupCount x genomeCount blowup the
 * Uint16Array matrix exists to avoid (see matrix.js), just deferred to
 * happen after the read instead of during it. Peak memory here is the
 * final matrix itself plus one row's transient strings, not the whole
 * matrix's worth of small strings held at once.
 *
 * Returns { genomeNames, groupsMeta, presenceMatrix, geneIdsByGroup } —
 * groupsMeta holds only { groupId, representativeId, annotation } per row
 * (no rawRow), consumed by assemblePangenomeData in index.js.
 */
export async function parseRoaryStream(lineIterator, { onProgress } = {}) {
  let headerInfo = null;
  let builder = null;
  const groupsMeta = [];
  let sawAnyLine = false;

  for await (const line of lineIterator) {
    if (line.length === 0) continue;
    sawAnyLine = true;
    if (!headerInfo) {
      headerInfo = parseHeaderLine(line);
      builder = new StreamingMatrixBuilder(headerInfo.genomeNames.length);
      if (onProgress) onProgress({ rows: 0, genomeCount: headerInfo.genomeNames.length });
      continue;
    }
    const { meta, rawRow } = parseDataLineStreaming(line, headerInfo);
    builder.addRow(rawRow);
    groupsMeta.push(meta);
    if (onProgress && groupsMeta.length % 5000 === 0) onProgress({ rows: groupsMeta.length });
  }

  if (!headerInfo || groupsMeta.length === 0) {
    const detail = sawAnyLine
      ? "Only a header line was found — no data rows followed it."
      : "No content at all was read from the file — the browser may have run out of memory while streaming it (check DevTools' console/memory tab), or the upload itself is empty.";
    throw new Error(`Roary file has no data rows. ${detail}`);
  }

  const { presenceMatrix, geneIdsByGroup } = builder.finish();
  return { genomeNames: headerInfo.genomeNames, groupsMeta, presenceMatrix, geneIdsByGroup };
}
