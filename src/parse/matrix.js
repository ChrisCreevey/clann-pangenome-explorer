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
//   - `geneIdsByGroup`: one entry per group (`undefined` unless that group
//     has at least one gene-ID-bearing cell), and — critically — that
//     entry's *shape* adapts to how full the row is:
//       - a `Map<genomeIndex, value>` for a sparse row (few genomes carry a
//         gene ID), where a Map's per-entry cost is only paid for genomes
//         actually present;
//       - a plain dense `Array` indexed directly by genomeIndex for a row
//         where most genomes carry a value, where a flat array's ~8
//         bytes/slot beats a Map's ~tens of bytes *per entry* once
//         occupancy passes roughly DENSE_OCCUPANCY_THRESHOLD.
//     Roary/Panaroo output is sorted core-genes-first, so the very rows
//     that are almost entirely filled in (one gene ID per genome, in
//     nearly every column) are exactly the ones a naive all-Map design
//     penalises hardest — this is what was blowing up memory on a large,
//     mostly-non-empty matrix despite the Uint16Array optimisation below.
//     Each `value` is a bare string for the common single-gene-ID cell, or
//     a string[] only when a cell genuinely holds more than one ID (a
//     multi-copy/paralog cell) — skipping the one-element-array wrapper
//     for the majority case.
//
// Every consumer that used to read `group.cells[genomeName]` now calls the
// accessors below with `group.groupIndex` and a genome index (from
// `genome.index` or `data.genomeNameToIndex`).

import { parsePresenceCell } from "./shared.js";

const DENSE_OCCUPANCY_THRESHOLD = 0.1;

/** [genomeIndex, value] pairs -> a Map (sparse row) or dense Array (row mostly filled in). */
function finalizeGeneIdRow(entries, genomeCount) {
  if (entries.length === 0) return undefined;
  if (entries.length / genomeCount < DENSE_OCCUPANCY_THRESHOLD) return new Map(entries);
  const dense = new Array(genomeCount);
  for (const [genomeIndex, value] of entries) dense[genomeIndex] = value;
  return dense;
}

function toGeneIdArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Build the flat matrix + adaptive gene-ID store from raw (unparsed) cell text. */
export function buildMatrix(rawGroups, genomeCount) {
  const groupCount = rawGroups.length;
  const presenceMatrix = new Uint16Array(groupCount * genomeCount);
  const geneIdsByGroup = new Array(groupCount);

  rawGroups.forEach((group, groupIndex) => {
    const base = groupIndex * genomeCount;
    const rawRow = group.rawRow;
    const entries = [];
    for (let genomeIndex = 0; genomeIndex < genomeCount; genomeIndex++) {
      const { copyCount, geneIds } = parsePresenceCell(rawRow[genomeIndex]);
      presenceMatrix[base + genomeIndex] = copyCount;
      if (geneIds.length) entries.push([genomeIndex, geneIds.length === 1 ? geneIds[0] : geneIds]);
    }
    geneIdsByGroup[groupIndex] = finalizeGeneIdRow(entries, genomeCount);
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
    const entries = [];
    for (let genomeIndex = 0; genomeIndex < this.genomeCount; genomeIndex++) {
      const { copyCount, geneIds } = parsePresenceCell(rawRow[genomeIndex]);
      this.presenceMatrix[base + genomeIndex] = copyCount;
      if (geneIds.length) entries.push([genomeIndex, geneIds.length === 1 ? geneIds[0] : geneIds]);
    }
    this.geneIdsByGroup[this.groupCount] = finalizeGeneIdRow(entries, this.genomeCount);
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
  const row = data.geneIdsByGroup[groupIndex];
  if (!row) return [];
  const value = Array.isArray(row) ? row[genomeIndex] : row.get(genomeIndex);
  return toGeneIdArray(value);
}

/** Every gene ID across every genome for one group, flattened (order not significant). */
export function allGeneIdsForGroup(data, groupIndex) {
  const row = data.geneIdsByGroup[groupIndex];
  if (!row) return [];
  const ids = [];
  if (Array.isArray(row)) {
    for (const value of row) if (value !== undefined) ids.push(...toGeneIdArray(value));
  } else {
    for (const value of row.values()) ids.push(...toGeneIdArray(value));
  }
  return ids;
}

/** [genomeName, geneIds[]] pairs for one group, genomes with no gene IDs omitted. */
export function geneIdsByGenomeForGroup(data, groupIndex) {
  const row = data.geneIdsByGroup[groupIndex];
  if (!row) return [];
  const out = [];
  if (Array.isArray(row)) {
    for (let genomeIndex = 0; genomeIndex < row.length; genomeIndex++) {
      const value = row[genomeIndex];
      if (value !== undefined) out.push([data.genomes[genomeIndex].name, toGeneIdArray(value)]);
    }
  } else {
    for (const [genomeIndex, value] of row.entries()) out.push([data.genomes[genomeIndex].name, toGeneIdArray(value)]);
  }
  return out;
}
