// matrix.js — the presence/copy-count storage backing PangenomeData.
//
// Replaces a per-cell { copyCount, geneIds } object (previously stored one
// per group per genome, present or absent — measured at ~58 bytes/cell,
// meaning a 10,000-genome x 20,000-group study needed >11GB of JS heap)
// with:
//
//   - `presenceMatrix`: a single flat Uint16Array, group-major
//     (index = groupIndex * genomeCount + genomeIndex), 2 bytes/cell with
//     zero per-cell allocation. The same 10,000x20,000 study now costs
//     ~400MB for this alone.
//   - `geneIdsByGroup`: a sparse array (one entry per group, `undefined`
//     unless that group has at least one gene-ID-bearing cell) of
//     `Map<genomeIndex, string[]>`. Formats without gene IDs (PanACoTA,
//     plain 0/1 generic matrices) never allocate anything here at all;
//     formats with them only pay for genomes where a group is actually
//     present, not for the (usually large) majority of absent cells.
//
// Every consumer that used to read `group.cells[genomeName]` now calls the
// accessors below with `group.groupIndex` and a genome index (from
// `genome.index` or `data.genomeNameToIndex`).

import { parsePresenceCell } from "./shared.js";

/** Build the flat matrix + sparse gene-ID store from raw (unparsed) cell text. */
export function buildMatrix(rawGroups, genomeCount) {
  const groupCount = rawGroups.length;
  const presenceMatrix = new Uint16Array(groupCount * genomeCount);
  const geneIdsByGroup = new Array(groupCount);

  rawGroups.forEach((group, groupIndex) => {
    const base = groupIndex * genomeCount;
    const rawRow = group.rawRow;
    for (let genomeIndex = 0; genomeIndex < genomeCount; genomeIndex++) {
      const { copyCount, geneIds } = parsePresenceCell(rawRow[genomeIndex]);
      presenceMatrix[base + genomeIndex] = copyCount;
      if (geneIds.length) {
        if (!geneIdsByGroup[groupIndex]) geneIdsByGroup[groupIndex] = new Map();
        geneIdsByGroup[groupIndex].set(genomeIndex, geneIds);
      }
    }
  });

  return { presenceMatrix, geneIdsByGroup };
}

/**
 * Incrementally builds the same { presenceMatrix, geneIdsByGroup } shape as
 * buildMatrix, one row at a time, for streaming callers that don't have the
 * full row count up front. Critically, each row's raw cell-text array is
 * only ever needed transiently in addRow() — unlike buildMatrix (which is
 * handed every row's raw strings already collected into one array), nothing
 * here holds more than one row's worth of raw text at a time. The matrix
 * grows by doubling (like a typical dynamic array), so total copying stays
 * amortised O(final size) rather than O(final size) per row.
 */
export class StreamingMatrixBuilder {
  constructor(genomeCount, initialCapacity = 4096) {
    this.genomeCount = genomeCount;
    this.capacity = Math.max(1, initialCapacity);
    this.presenceMatrix = new Uint16Array(genomeCount * this.capacity);
    this.geneIdsByGroup = [];
    this.groupCount = 0;
  }

  addRow(rawRow) {
    if (this.groupCount >= this.capacity) this._grow();
    const base = this.groupCount * this.genomeCount;
    for (let genomeIndex = 0; genomeIndex < this.genomeCount; genomeIndex++) {
      const { copyCount, geneIds } = parsePresenceCell(rawRow[genomeIndex]);
      this.presenceMatrix[base + genomeIndex] = copyCount;
      if (geneIds.length) {
        if (!this.geneIdsByGroup[this.groupCount]) this.geneIdsByGroup[this.groupCount] = new Map();
        this.geneIdsByGroup[this.groupCount].set(genomeIndex, geneIds);
      }
    }
    this.groupCount++;
  }

  _grow() {
    this.capacity *= 2;
    const grown = new Uint16Array(this.genomeCount * this.capacity);
    grown.set(this.presenceMatrix);
    this.presenceMatrix = grown;
  }

  /** Trim the matrix to the actual row count written. Call once, after the last addRow(). */
  finish() {
    return {
      presenceMatrix: this.presenceMatrix.subarray(0, this.groupCount * this.genomeCount),
      geneIdsByGroup: this.geneIdsByGroup,
    };
  }
}

export function copyCountAt(data, groupIndex, genomeIndex) {
  return data.presenceMatrix[groupIndex * data.meta.genomeCount + genomeIndex];
}

export function presentAt(data, groupIndex, genomeIndex) {
  return copyCountAt(data, groupIndex, genomeIndex) > 0;
}

/** Zero-copy view of one group's copy counts across every genome, in genome order. */
export function presenceVector(data, groupIndex) {
  const n = data.meta.genomeCount;
  return data.presenceMatrix.subarray(groupIndex * n, groupIndex * n + n);
}

/**
 * A genome's copy-count vector across every group, for column
 * clustering. Unlike presenceVector, this can't be a zero-copy view — the
 * matrix is group-major, so one genome's data is strided (stride =
 * genomeCount) rather than contiguous — so this materialises a fresh
 * Uint16Array, O(groupCount) per call.
 */
export function genomeVector(data, genomeIndex) {
  const genomeCount = data.meta.genomeCount;
  const groupCount = data.groups.length;
  const vector = new Uint16Array(groupCount);
  for (let g = 0; g < groupCount; g++) vector[g] = data.presenceMatrix[g * genomeCount + genomeIndex];
  return vector;
}

/** Gene IDs for one specific group/genome cell (empty array if none). */
export function geneIdsAt(data, groupIndex, genomeIndex) {
  const map = data.geneIdsByGroup[groupIndex];
  return (map && map.get(genomeIndex)) || [];
}

/** Every gene ID across every genome for one group, flattened (order not significant). */
export function allGeneIdsForGroup(data, groupIndex) {
  const map = data.geneIdsByGroup[groupIndex];
  if (!map) return [];
  const ids = [];
  for (const geneIds of map.values()) ids.push(...geneIds);
  return ids;
}

/** [genomeName, geneIds[]] pairs for one group, genomes with no gene IDs omitted. */
export function geneIdsByGenomeForGroup(data, groupIndex) {
  const map = data.geneIdsByGroup[groupIndex];
  if (!map) return [];
  return [...map.entries()].map(([genomeIndex, geneIds]) => [data.genomes[genomeIndex].name, geneIds]);
}
