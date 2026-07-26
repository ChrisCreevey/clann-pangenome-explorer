// pairs.js — resolve CoinFinder pairs against loaded groups, and the
// category-by-category / cross-category analyses built on top (build
// brief §6 Phase 6, the module getting the most build attention).

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

/**
 * Category-by-category summary: for every unordered category combination
 * appearing among resolved pairs (e.g. "AMR × Virulence"), the count of
 * associated and disassociated pairs. Answers "do AMR and virulence genes
 * tend to co-occur" directly (build brief §6 Phase 6).
 */
export function categoryMatrix(data) {
  const combos = new Map(); // comboKey -> { categories: [a,b], associated, disassociated }
  for (const pair of data.pairs) {
    const catA = categoryFor(pair.resolvedA);
    const catB = categoryFor(pair.resolvedB);
    const categories = [catA, catB].sort();
    const key = categories.join(" × ");
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
