// pairs.js — resolve CoinFinder pairs against loaded groups, and the
// category-by-category / cross-category analyses built on top (build
// brief §6 Phase 6, the module getting the most build attention).

import { annotationSearchText } from "../parse/annotation.js";

/**
 * A group's category for pair analysis purposes is its first tag, or
 * 'uncategorised' if it has none. Groups can carry several tags (build
 * brief §9d: flat label set, no hierarchy) but collapsing to one keeps
 * the category-by-category matrix and cross-category view legible —
 * exactly the common case of a single AMR/virulence/etc. tagging pass.
 */
export function categoryFor(group) {
  return group.tags.length ? group.tags[0] : "uncategorised";
}

/**
 * Resolve associated/disassociated pair rows (from parseCoinfinderFile)
 * against `data.groups`, appending to data.pairs (both sides matched) and
 * data.unmatchedPairs (either side missing — reported, never dropped).
 * Returns { matched, unmatched } counts for the rows just added.
 */
export function resolvePairs(data, rows, direction) {
  const byId = new Map(data.groups.map((g) => [g.groupId, g]));
  let matched = 0, unmatched = 0;

  for (const row of rows) {
    const resolvedA = byId.get(row.groupIdA) || null;
    const resolvedB = byId.get(row.groupIdB) || null;
    const pair = { groupIdA: row.groupIdA, groupIdB: row.groupIdB, direction, significance: row.significance, resolvedA, resolvedB };
    if (resolvedA && resolvedB) { data.pairs.push(pair); matched++; }
    else { data.unmatchedPairs.push(pair); unmatched++; }
  }
  return { matched, unmatched };
}

const UNCATEGORISED_COMBO_KEY = "uncategorised × uncategorised";

/**
 * Category-by-category summary: for every unordered category combination
 * appearing among `pairs` (e.g. "AMR × Virulence"), the count of
 * associated and disassociated pairs. Answers "do AMR and virulence genes
 * tend to co-occur" directly (build brief §6 Phase 6). Takes a pairs array
 * (typically the pair table's current filter selection) rather than the
 * whole dataset, so this stays consistent with every other pair-derived
 * view once a Groups/pair-table filter is active.
 *
 * "uncategorised × uncategorised" is deliberately excluded: in a
 * typical study most groups never get a tag at all, so that combination
 * is usually the overwhelming majority of pairs and swamps every
 * combination that actually involves a category — it doesn't answer any
 * question this matrix exists to answer, it just crowds out the ones
 * that do. Combinations with exactly one uncategorised side (e.g. "AMR ×
 * uncategorised") stay, since those are genuinely informative.
 */
export function categoryMatrix(pairs) {
  const combos = new Map(); // comboKey -> { categories: [a,b], associated, disassociated }
  for (const pair of pairs) {
    const catA = categoryFor(pair.resolvedA);
    const catB = categoryFor(pair.resolvedB);
    const categories = [catA, catB].sort();
    const key = categories.join(" × ");
    if (key === UNCATEGORISED_COMBO_KEY) continue;
    if (!combos.has(key)) combos.set(key, { key, categories, associated: 0, disassociated: 0 });
    combos.get(key)[pair.direction === "associated" ? "associated" : "disassociated"]++;
  }
  return [...combos.values()].sort((a, b) => (b.associated + b.disassociated) - (a.associated + a.disassociated));
}

/**
 * Pairs whose two sides fall in different categories — one tagged, one
 * not, or two different tags. This is the primary "notice an unexpected
 * association" lens (build brief §6 Phase 6), independent of significance.
 */
export function crossCategoryPairs(data) {
  return data.pairs.filter((pair) => categoryFor(pair.resolvedA) !== categoryFor(pair.resolvedB));
}

/**
 * Pairs sorted purely by significance, ignoring category — the second
 * "notice something unexpected" lens, so the strongest signals in the
 * data are visible even before any tag has been applied. Lower
 * significance values (p/q-values) sort first; pairs with no
 * significance value sort last.
 */
export function sortBySignificance(pairs) {
  return pairs.slice().sort((a, b) => {
    if (a.significance == null && b.significance == null) return 0;
    if (a.significance == null) return 1;
    if (b.significance == null) return -1;
    return a.significance - b.significance;
  });
}

/**
 * Filter resolved pairs — the main lens for "find associated/disassociated
 * groups based on annotation" at scale, since browsing the raw pair list
 * directly stops being practical once it runs into the hundreds of
 * thousands of rows. Any criterion left undefined/empty is not applied.
 *
 * `annotationText` matches if EITHER side's combined annotation text
 * (matrix annotation plus every uploaded annotation column, via
 * annotationSearchText) contains it. `tags` matches if either side
 * carries any of the listed tags. `direction` restricts to
 * 'associated'/'disassociated' (an array, so both can be selected).
 * `maxSignificance` drops pairs with no significance value or a value
 * above the threshold. `crossCategoryOnly` keeps only pairs whose two
 * sides fall in different categories. `groupIds` (a Set of group IDs —
 * typically the sidebar-filtered Groups selection) requires BOTH sides
 * of the pair to be in the set, not either: this is the link between the
 * Groups filter and every pair-derived view (pair table, network graph),
 * always applied, so "an association" only ever means one strictly
 * within whatever the Groups filter currently shows.
 */
export function filterPairs(data, pairs, criteria = {}) {
  const { direction, maxSignificance, crossCategoryOnly, annotationText, tags, groupIds } = criteria;
  const needle = annotationText ? annotationText.trim().toLowerCase() : null;

  return pairs.filter((pair) => {
    if (groupIds && (!groupIds.has(pair.groupIdA) || !groupIds.has(pair.groupIdB))) return false;
    if (direction && direction.length && !direction.includes(pair.direction)) return false;
    if (maxSignificance != null && (pair.significance == null || pair.significance > maxSignificance)) return false;
    if (crossCategoryOnly && categoryFor(pair.resolvedA) === categoryFor(pair.resolvedB)) return false;
    if (needle && !annotationSearchText(data, pair.resolvedA).includes(needle) && !annotationSearchText(data, pair.resolvedB).includes(needle)) return false;
    if (tags && tags.length && !tags.some((t) => pair.resolvedA.tags.includes(t) || pair.resolvedB.tags.includes(t))) return false;
    return true;
  });
}

/**
 * Per-group rollup of association/disassociation counts within `pairs`
 * (already filtered/resolved) — one row per group appearing in at least
 * one of those pairs, carrying every field the group itself has (its
 * matrix annotation, every uploaded annotation column, tags, frequency
 * class, isolate/sequence counts — same shape the Groups table already
 * uses, so the same dynamic-column logic can render or export it) plus
 * associated/disassociated/total counts computed from `pairs`. This is
 * "annotations mapped to associations" as a browsable, exportable table,
 * sorted most-connected first.
 */
export function groupAssociationSummary(pairs) {
  const rows = new Map(); // groupId -> { group, associated, disassociated }
  for (const pair of pairs) {
    for (const group of [pair.resolvedA, pair.resolvedB]) {
      if (!rows.has(group.groupId)) rows.set(group.groupId, { group, associated: 0, disassociated: 0 });
      rows.get(group.groupId)[pair.direction === "associated" ? "associated" : "disassociated"]++;
    }
  }
  return [...rows.values()]
    .map(({ group, associated, disassociated }) => ({ ...group, associated, disassociated, total: associated + disassociated }))
    .sort((a, b) => b.total - a.total);
}
