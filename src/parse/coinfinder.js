// coinfinder.js — import a CoinFinder associated- or disassociated-pairs
// file (build brief §6 Phase 6). CoinFinder's exact column names vary by
// version, so this routes through the same best-guess-then-confirm
// pattern as the generic pangenome-matrix fallback: pick the two gene-ID
// columns and the significance column by name/shape, and only ask for a
// manual mapping (ColumnMappingNeeded) when that guess is genuinely
// ambiguous — never silently guessing wrong.

import { splitDelimited, detectDelimiter, ColumnMappingNeeded } from "./shared.js";

const ID_NAME_RE = /gene|group|node/i;
const SIG_NAME_RE = /p.?value|p.?adj|padj|q.?value|prob|signif|score/i;

function looksNumericColumn(rows, colIndex, sample = 50) {
  let seen = 0;
  for (const row of rows.slice(0, sample)) {
    const v = (row[colIndex] ?? "").trim();
    if (v === "") continue;
    seen++;
    if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v)) return false;
  }
  return seen > 0;
}

function idMatchRate(rows, colIndex, groupIds, sample = 200) {
  const values = rows.slice(0, sample).map((r) => r[colIndex]);
  const hits = values.filter((v) => groupIds.has(v)).length;
  return values.length ? hits / values.length : 0;
}

function parseRows(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("CoinFinder file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitDelimited(l, delimiter));
  return { header, rows };
}

/**
 * Parse a CoinFinder pair file into [{ groupIdA, groupIdB, significance }].
 * @param {string} text
 * @param {import("./index.js").PangenomeData} data used to best-guess the ID columns
 * @param {{ colA?: number, colB?: number, sigCol?: number }} opts manual column override
 */
export function parseCoinfinderFile(text, data, opts = {}) {
  const { header, rows } = parseRows(text);
  const groupIds = new Set(data.groups.map((g) => g.groupId));

  let { colA, colB, sigCol } = opts;

  if (colA === undefined || colB === undefined) {
    const byName = header.map((h, i) => (ID_NAME_RE.test(h) ? i : -1)).filter((i) => i >= 0);
    const byMatch = header
      .map((_, i) => ({ i, rate: idMatchRate(rows, i, groupIds) }))
      .filter((c) => c.rate >= 0.3)
      .sort((a, b) => b.rate - a.rate)
      .map((c) => c.i);
    const candidates = [...new Set([...byMatch, ...byName])];
    if (candidates.length < 2) {
      throw new ColumnMappingNeeded(
        "Couldn't identify two gene-ID columns to match against your loaded groups.",
        { previewHeader: header, previewRows: rows.slice(0, 8) }
      );
    }
    [colA, colB] = candidates;
  }

  if (sigCol === undefined) {
    const byName = header.findIndex((h) => SIG_NAME_RE.test(h));
    if (byName >= 0) sigCol = byName;
    else {
      const numericCols = header
        .map((_, i) => i)
        .filter((i) => i !== colA && i !== colB && looksNumericColumn(rows, i));
      if (!numericCols.length) {
        throw new ColumnMappingNeeded(
          "Couldn't identify a significance/probability column.",
          { previewHeader: header, previewRows: rows.slice(0, 8) }
        );
      }
      sigCol = numericCols[0];
    }
  }

  return rows.map((row) => ({
    groupIdA: row[colA],
    groupIdB: row[colB],
    significance: row[sigCol] !== undefined && row[sigCol] !== "" ? Number(row[sigCol]) : null,
  }));
}
