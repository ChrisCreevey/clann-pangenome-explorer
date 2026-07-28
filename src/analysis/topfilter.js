// topfilter.js — filtering/sorting, pattern matching, two-group comparison,
// singleton and multi-copy detection (build brief §6, Phase 4). All pure
// functions over PangenomeData; no DOM here.

import { copyCountAt } from "../parse/matrix.js";
import { annotationSearchText } from "../parse/annotation.js";

/**
 * Filter groups by frequency class, presence/sequence counts, average
 * copies per genome, and annotation text. Any criterion left undefined is
 * not applied. `criteria.freqClasses` is an array like ['core','shell'].
 */
export function filterGroups(data, criteria = {}) {
  const {
    freqClasses, minGenomesPresentIn, maxGenomesPresentIn,
    minSequencesTotal, maxSequencesTotal,
    minAvgCopiesPerGenome, maxAvgCopiesPerGenome,
    annotationText, tags,
  } = criteria;

  return data.groups.filter((g) => {
    if (freqClasses && freqClasses.length && !freqClasses.includes(g.freqClass)) return false;
    if (minGenomesPresentIn != null && g.genomesPresentIn < minGenomesPresentIn) return false;
    if (maxGenomesPresentIn != null && g.genomesPresentIn > maxGenomesPresentIn) return false;
    if (minSequencesTotal != null && g.sequencesTotal < minSequencesTotal) return false;
    if (maxSequencesTotal != null && g.sequencesTotal > maxSequencesTotal) return false;
    if (minAvgCopiesPerGenome != null && g.avgCopiesPerGenome < minAvgCopiesPerGenome) return false;
    if (maxAvgCopiesPerGenome != null && g.avgCopiesPerGenome > maxAvgCopiesPerGenome) return false;
    if (annotationText && !annotationSearchText(data, g).includes(annotationText.toLowerCase())) return false;
    if (tags && tags.length && !tags.some((t) => g.tags.includes(t))) return false;
    return true;
  });
}

/**
 * Presence/absence pattern matching against a defined genome subset:
 * groups present in every genome of `presentIn` and absent from every
 * genome of `absentFrom` (either list may be empty).
 */
export function patternMatch(data, { presentIn = [], absentFrom = [] } = {}) {
  const presentInIdx = presentIn.map((name) => data.genomeNameToIndex.get(name));
  const absentFromIdx = absentFrom.map((name) => data.genomeNameToIndex.get(name));
  return data.groups.filter((g) => {
    for (const genomeIndex of presentInIdx) {
      if (copyCountAt(data, g.groupIndex, genomeIndex) <= 0) return false;
    }
    for (const genomeIndex of absentFromIdx) {
      if (copyCountAt(data, g.groupIndex, genomeIndex) > 0) return false;
    }
    return true;
  });
}

/**
 * Two-group comparison: split genomes into set A and set B, and rank
 * groups by presence difference. Returns a 2x2 contingency table (a =
 * present in A, b = absent from A, c = present in B, d = absent from B)
 * and an odds ratio per group, explicitly descriptive rather than a
 * formal significance test (build brief §9e). Uses a Haldane-Anscombe
 * +0.5 correction when any cell is zero, to keep the ratio finite.
 */
export function twoGroupComparison(data, genomesA, genomesB) {
  const idxA = genomesA.map((name) => data.genomeNameToIndex.get(name));
  const idxB = genomesB.map((name) => data.genomeNameToIndex.get(name));
  const presentCount = (group, indices) => indices.reduce((n, genomeIndex) => (
    n + (copyCountAt(data, group.groupIndex, genomeIndex) > 0 ? 1 : 0)
  ), 0);

  return data.groups.map((g) => {
    const presentA = presentCount(g, idxA);
    const presentB = presentCount(g, idxB);
    const absentA = genomesA.length - presentA;
    const absentB = genomesB.length - presentB;
    const hasZero = presentA === 0 || absentA === 0 || presentB === 0 || absentB === 0;
    const a = presentA + (hasZero ? 0.5 : 0);
    const b = absentA + (hasZero ? 0.5 : 0);
    const c = presentB + (hasZero ? 0.5 : 0);
    const d = absentB + (hasZero ? 0.5 : 0);
    const oddsRatio = (a * d) / (b * c);
    return {
      groupId: g.groupId,
      annotation: g.annotation,
      freqClass: g.freqClass,
      presentA, totalA: genomesA.length,
      presentB, totalB: genomesB.length,
      pctA: genomesA.length ? (presentA / genomesA.length) * 100 : 0,
      pctB: genomesB.length ? (presentB / genomesB.length) * 100 : 0,
      oddsRatio,
      correctedForZeroCell: hasZero,
    };
  }).sort((x, y) => Math.abs(y.pctA - y.pctB) - Math.abs(x.pctA - x.pctB));
}

/** Groups present in exactly one genome, grouped by which genome. */
export function singletonsPerGenome(data) {
  const byGenome = new Map(data.genomes.map((g) => [g.name, []]));
  for (const g of data.groups) {
    if (g.genomesPresentIn !== 1) continue;
    for (const genome of data.genomes) {
      if (copyCountAt(data, g.groupIndex, genome.index) > 0) { byGenome.get(genome.name).push(g); break; }
    }
  }
  return byGenome;
}

/**
 * Groups whose average copies per genome exceeds `threshold` — candidate
 * multi-copy gene families for downstream reconciliation (build brief
 * §6 Phase 4, §7 export, §9c naming placeholder).
 */
export function multiCopyCandidates(data, threshold = 1.5) {
  return data.groups
    .filter((g) => g.avgCopiesPerGenome > threshold)
    .sort((a, b) => b.avgCopiesPerGenome - a.avgCopiesPerGenome);
}
