// csv-util.js — small shared CSV/TSV formatting helper for the export modules.

/** Quote a field only if it needs it (contains the delimiter, a quote, or a newline). */
export function escapeField(value, delimiter) {
  const s = value === undefined || value === null ? "" : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a delimited-text document (with header) from column definitions and rows. */
export function toDelimited(header, rows, delimiter = ",") {
  const lines = [header.map((h) => escapeField(h, delimiter)).join(delimiter)];
  for (const row of rows) lines.push(row.map((v) => escapeField(v, delimiter)).join(delimiter));
  return lines.join("\n") + "\n";
}
