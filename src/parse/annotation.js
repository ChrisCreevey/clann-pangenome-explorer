// annotation.js — import an annotation table keyed either to gene groups
// directly (Workflow A) or to individual genes across every genome
// (Workflow B, rolled up to a per-group consensus). Build brief §6 Phase 5.

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
 * Workflow A: one row per group, joined directly onto group.annotation.
 * Returns { matched, unmatchedIds }.
 */
export function applyWorkflowA(data, text, opts = {}) {
  const { header, rows } = parseRows(text);
  const { idCol, annotationCol } = { ...guessIdAndAnnotationColumns(header), ...opts };
  const byId = new Map(data.groups.map((g) => [g.groupId, g]));
  const unmatchedIds = [];
  let matched = 0;

  for (const row of rows) {
    const id = row[idCol];
    const group = byId.get(id);
    if (!group) { unmatchedIds.push(id); continue; }
    group.annotation = row[annotationCol] || null;
    group.consensusAnnotation = null;
    group.consistencyScore = null;
    group.annotationBreakdown = null;
    matched++;
  }
  data.meta.annotationWorkflow = "A";
  return { matched, unmatchedIds };
}

/**
 * Workflow B: one row per gene (across every genome), rolled up to a
 * per-group consensus (majority annotation), a consistency score
 * (majority count / total constituent genes seen), and the full
 * disagreement breakdown. A consensus is only accepted when it clears
 * both `minCount` (absolute) and `minPercent` (share of the group's
 * annotated genes) — otherwise the group is left unannotated but its
 * breakdown is still recorded so the disagreement is visible rather than
 * silently dropped. Returns { matched, unmatchedIds, acceptedCount, rejectedCount }.
 */
export function applyWorkflowB(data, text, opts = {}) {
  const { minCount = 1, minPercent = 50 } = opts;
  const { header, rows } = parseRows(text);
  const { idCol, annotationCol } = { ...guessIdAndAnnotationColumns(header), ...opts };
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

    group.annotationBreakdown = breakdown;
    group.consistencyScore = top.pct / 100;
    if (accepted) {
      group.consensusAnnotation = top.annotation;
      group.annotation = top.annotation;
      acceptedCount++;
    } else {
      group.consensusAnnotation = null;
      group.annotation = null;
      rejectedCount++;
    }
  }

  data.meta.annotationWorkflow = "B";
  return { matched, unmatchedIds, acceptedCount, rejectedCount };
}
