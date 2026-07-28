// annotation.js — import an annotation table keyed either to gene groups
// directly (Workflow A) or to individual genes across every genome
// (Workflow B, rolled up to a per-group consensus). Build brief §6 Phase 5.
//
// Each upload adds a new column rather than overwriting the last one: the
// matrix's own `group.annotation` (e.g. Roary's "Annotation" column) is
// never touched, and every applyWorkflowA/B call records its result in
// `data.meta.annotationSources` (one entry per upload, header taken from
// the file's own column header) plus a matching per-group entry in
// `group.annotationColumns[key]`, so a group can carry annotations from
// several independently-uploaded files at once.

import { splitDelimited, detectDelimiter } from "./shared.js";
import { allGeneIdsForGroup } from "./matrix.js";

/** Every gene ID appearing in any group's cells, mapped back to its group ID. */
export function buildGeneToGroupIndex(data) {
  const index = new Map();
  for (const group of data.groups) {
    for (const geneId of allGeneIdsForGroup(data, group.groupIndex)) {
      index.set(geneId, group.groupId);
    }
  }
  return index;
}

function parseRows(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("Annotation file has no data rows.");
  const delimiter = detectDelimiter(lines[0]);
  const header = splitDelimited(lines[0], delimiter);
  const rows = lines.slice(1).map((l) => splitDelimited(l, delimiter));
  return { header, rows };
}

function guessIdAndAnnotationColumns(header) {
  const idIdx = header.findIndex((h) => /^(gene[_ ]?id|group[_ ]?id|id|gene|group)$/i.test(h.trim()));
  const annIdx = header.findIndex((h) => /annotation|product|description|function/i.test(h.trim()));
  const idCol = idIdx >= 0 ? idIdx : 0;
  const annotationCol = annIdx >= 0 ? annIdx : (idCol === 0 ? 1 : 0);
  return { idCol, annotationCol };
}

/**
 * Decide whether an annotation file is Workflow A (one row per group) or
 * Workflow B (one row per gene, many rows per group) by matching its ID
 * column against group IDs vs. individual gene IDs already loaded.
 */
export function detectAnnotationWorkflow(data, text) {
  const { header, rows } = parseRows(text);
  const { idCol } = guessIdAndAnnotationColumns(header);
  const ids = rows.map((r) => r[idCol]);
  const groupIds = new Set(data.groups.map((g) => g.groupId));
  const geneIndex = buildGeneToGroupIndex(data);

  const groupMatchRate = ids.filter((id) => groupIds.has(id)).length / ids.length;
  const geneMatchRate = ids.filter((id) => geneIndex.has(id)).length / ids.length;

  if (groupMatchRate >= geneMatchRate && groupMatchRate >= 0.5) return "A";
  if (geneMatchRate > 0.5) return "B";
  return "unknown";
}

/**
 * Register a new annotation source (or reuse an existing one, when
 * `sourceKey` names an already-registered source, so re-applying the same
 * upload with different consensus thresholds updates its column in place
 * instead of appending a duplicate). Returns the source's key.
 */
function registerAnnotationSource(data, { header, workflow, sourceKey }) {
  if (!data.meta.annotationSources) data.meta.annotationSources = [];
  const sources = data.meta.annotationSources;

  if (sourceKey) {
    const existing = sources.find((s) => s.key === sourceKey);
    if (existing) {
      existing.header = header || existing.header;
      existing.workflow = workflow;
      return existing.key;
    }
  }

  const existingHeaders = new Set(sources.map((s) => s.header));
  let label = header || "Annotation";
  let uniqueLabel = label, n = 2;
  while (existingHeaders.has(uniqueLabel)) { uniqueLabel = `${label} (${n})`; n++; }

  const key = sourceKey || `ann${sources.length + 1}_${Date.now().toString(36)}`;
  sources.push({ key, header: uniqueLabel, workflow, matched: 0, unmatchedIds: [] });
  return key;
}

/**
 * Record one group's value for an annotation column, both as structured
 * detail (`group.annotationColumns[key]`, for the detail card) and as flat
 * properties (`group["ann_"+key]`, `group["annMatched_"+key]`) so the
 * group table can sort/display them like any other column.
 */
function setAnnotationColumn(group, key, entry) {
  if (!group.annotationColumns) group.annotationColumns = {};
  group.annotationColumns[key] = entry;
  group[`ann_${key}`] = entry.value;
  if (entry.matchedCount != null) group[`annMatched_${key}`] = entry.matchedCount;
}

/**
 * Move an annotation source earlier/later in `data.meta.annotationSources`,
 * which is the order every consumer (Filtered groups table, its CSV
 * export, group detail card) renders annotation columns in. `direction` is
 * -1 (move earlier/left) or 1 (move later/right). No-op at either end.
 */
export function reorderAnnotationSource(data, key, direction) {
  const sources = data.meta.annotationSources || [];
  const index = sources.findIndex((s) => s.key === key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sources.length) return;
  [sources[index], sources[target]] = [sources[target], sources[index]];
}

/** Combined free-text search surface for a group: the matrix's own annotation plus every uploaded annotation column's value. */
export function annotationSearchText(data, group) {
  const parts = [group.annotation];
  for (const source of data.meta.annotationSources || []) {
    const col = group.annotationColumns && group.annotationColumns[source.key];
    if (col) parts.push(col.value);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Workflow A: one row per group, added as a new annotation column keyed by
 * the file's own annotation-column header (rather than overwriting
 * `group.annotation`). Returns { matched, unmatchedIds, key, header }.
 */
export function applyWorkflowA(data, text, opts = {}) {
  const { header, rows } = parseRows(text);
  const { idCol, annotationCol } = { ...guessIdAndAnnotationColumns(header), ...opts };
  const columnHeader = header[annotationCol] || "Annotation";
  const key = registerAnnotationSource(data, { header: columnHeader, workflow: "A", sourceKey: opts.sourceKey });

  const byId = new Map(data.groups.map((g) => [g.groupId, g]));
  const unmatchedIds = [];
  let matched = 0;

  for (const row of rows) {
    const id = row[idCol];
    const group = byId.get(id);
    if (!group) { unmatchedIds.push(id); continue; }
    setAnnotationColumn(group, key, { value: row[annotationCol] || null });
    matched++;
  }

  const source = data.meta.annotationSources.find((s) => s.key === key);
  Object.assign(source, { matched, unmatchedIds });
  return { matched, unmatchedIds, key, header: source.header };
}

/**
 * Workflow B: one row per gene (across every genome), added as a new
 * annotation column holding, per group, the per-group consensus (majority
 * annotation), a consistency score (majority count / total constituent
 * genes seen), the number of constituent genes matched into that group
 * (surfaced as its own "matched" indicator alongside the value), and the
 * full disagreement breakdown. A consensus is only accepted when it clears
 * both `minCount` (absolute) and `minPercent` (share of the group's
 * annotated genes) — otherwise the group's value is left blank but its
 * breakdown and matched count are still recorded so the disagreement stays
 * visible rather than silently dropped.
 * Returns { matched, unmatchedIds, acceptedCount, rejectedCount, key, header }.
 */
export function applyWorkflowB(data, text, opts = {}) {
  const { minCount = 1, minPercent = 50 } = opts;
  const { header, rows } = parseRows(text);
  const { idCol, annotationCol } = { ...guessIdAndAnnotationColumns(header), ...opts };
  const columnHeader = header[annotationCol] || "Annotation";
  const key = registerAnnotationSource(data, { header: columnHeader, workflow: "B", sourceKey: opts.sourceKey });

  const geneIndex = buildGeneToGroupIndex(data);
  const byGroupId = new Map(data.groups.map((g) => [g.groupId, g]));

  const tally = new Map(); // groupId -> Map(annotation -> count)
  const unmatchedIds = [];
  let matched = 0;

  for (const row of rows) {
    const geneId = row[idCol];
    const groupId = geneIndex.get(geneId);
    if (!groupId) { unmatchedIds.push(geneId); continue; }
    matched++;
    const annotation = row[annotationCol] || "(no annotation)";
    if (!tally.has(groupId)) tally.set(groupId, new Map());
    const counts = tally.get(groupId);
    counts.set(annotation, (counts.get(annotation) || 0) + 1);
  }

  let acceptedCount = 0, rejectedCount = 0;
  for (const [groupId, counts] of tally) {
    const group = byGroupId.get(groupId);
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    const breakdown = [...counts.entries()]
      .map(([annotation, count]) => ({ annotation, count, pct: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
    const top = breakdown[0];
    const accepted = top.count >= minCount && top.pct >= minPercent;

    setAnnotationColumn(group, key, {
      value: accepted ? top.annotation : null,
      matchedCount: total,
      consistencyScore: top.pct / 100,
      breakdown,
    });
    if (accepted) acceptedCount++; else rejectedCount++;
  }

  const source = data.meta.annotationSources.find((s) => s.key === key);
  Object.assign(source, { matched, unmatchedIds, acceptedCount, rejectedCount, minCount, minPercent });
  return { matched, unmatchedIds, acceptedCount, rejectedCount, key, header: source.header };
}
