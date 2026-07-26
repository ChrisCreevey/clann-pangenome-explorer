// tags.js — category tagging (build brief §6 Phase 5): keyword tagging and
// list-upload tagging. Tags are a flat label set — a group can hold more
// than one (build brief §9d: no hierarchy, for simplicity).

import { splitDelimited, detectDelimiter } from "../parse/shared.js";

/**
 * Tag every group whose annotation text matches any of `terms`
 * (case-insensitive substring match) with `tagName`. Returns the number
 * of groups newly tagged (groups already carrying the tag aren't recounted).
 */
export function keywordTag(data, tagName, terms) {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  let count = 0;
  for (const group of data.groups) {
    const haystack = (group.annotation || "").toLowerCase();
    if (!needles.some((t) => haystack.includes(t))) continue;
    if (!group.tags.includes(tagName)) { group.tags.push(tagName); count++; }
  }
  return count;
}

/**
 * Tag groups from an uploaded two-column (group ID, category) file.
 * Returns { matched, unmatchedIds }.
 */
export function listUploadTag(data, text, opts = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) throw new Error("Tag list file is empty.");
  const delimiter = detectDelimiter(lines[0]);
  const firstRow = splitDelimited(lines[0], delimiter);
  // skip a header row if its second column doesn't look like a category label
  // (heuristic: header cells often literally say "category"/"tag"/"group")
  const hasHeader = /^(group[_ ]?id|id)$/i.test((firstRow[0] || "").trim()) || /^(category|tag|categories|tags)$/i.test((firstRow[1] || "").trim());
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const byId = new Map(data.groups.map((g) => [g.groupId, g]));
  const unmatchedIds = [];
  let matched = 0;

  for (const line of dataLines) {
    const row = splitDelimited(line, delimiter);
    const id = (row[opts.groupIdCol ?? 0] || "").trim();
    const category = (row[opts.categoryCol ?? 1] || "").trim();
    if (!id || !category) continue;
    const group = byId.get(id);
    if (!group) { unmatchedIds.push(id); continue; }
    if (!group.tags.includes(category)) group.tags.push(category);
    matched++;
  }
  return { matched, unmatchedIds };
}

/** Remove `tagName` from every group that carries it. Returns the number removed. */
export function clearTag(data, tagName) {
  let count = 0;
  for (const group of data.groups) {
    const idx = group.tags.indexOf(tagName);
    if (idx >= 0) { group.tags.splice(idx, 1); count++; }
  }
  return count;
}

/** All distinct tags currently in use, with per-tag group counts. */
export function listTags(data) {
  const counts = new Map();
  for (const group of data.groups) {
    for (const tag of group.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}
