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
 * A group-major Uint16Array matrix built out of fixed-size row chunks
 * instead of one contiguous buffer. Used only by StreamingMatrixBuilder,
 * where the final row count isn't known up front — a naive "double the
 * buffer and copy" growth strategy (as buildMatrix's single allocation
 * doesn't need, since it knows groupCount from the start) briefly holds
 * *both* the old and new buffers alive during each copy. For a wide matrix
 * that spike can rival or exceed the final matrix size — it's what caused
 * a real 1.63GB/7,057-genome file to crash right at a doubling boundary
 * despite every other optimisation here. A chunk, once allocated, is never
 * resized or copied, so there is no such spike at any point.
 */
class ChunkedPresenceMatrix {
  constructor(genomeCount, rowsPerChunk) {
    this.genomeCount = genomeCount;
    this.rowsPerChunk = rowsPerChunk;
    this.chunks = [];
    this.groupCount = 0; // set by the builder once the last row's been added
  }

  _chunkFor(rowIndex) {
    const chunkIndex = Math.floor(rowIndex / this.rowsPerChunk);
    let chunk = this.chunks[chunkIndex];
    if (!chunk) {
      chunk = new Uint16Array(this.rowsPerChunk * this.genomeCount);
      this.chunks[chunkIndex] = chunk;
    }
    return { chunk, rowInChunk: rowIndex % this.rowsPerChunk };
  }

  setCell(rowIndex, genomeIndex, value) {
    const { chunk, rowInChunk } = this._chunkFor(rowIndex);
    chunk[rowInChunk * this.genomeCount + genomeIndex] = value;
  }

  get(rowIndex, genomeIndex) {
    const chunk = this.chunks[Math.floor(rowIndex / this.rowsPerChunk)];
    if (!chunk) return 0;
    return chunk[(rowIndex % this.rowsPerChunk) * this.genomeCount + genomeIndex];
  }

  /** Zero-copy view of one row — safe because a row is never split across a chunk boundary. */
  rowView(rowIndex) {
    const chunk = this.chunks[Math.floor(rowIndex / this.rowsPerChunk)];
    const rowInChunk = rowIndex % this.rowsPerChunk;
    const base = rowInChunk * this.genomeCount;
    return chunk ? chunk.subarray(base, base + this.genomeCount) : new Uint16Array(this.genomeCount);
  }

  /** Full group-major iteration, matching a flat Uint16Array's element order — used by tests/debugging, not the hot path. */
  *[Symbol.iterator]() {
    for (let rowIndex = 0; rowIndex < this.groupCount; rowIndex++) {
      const row = this.rowView(rowIndex);
      for (let g = 0; g < this.genomeCount; g++) yield row[g];
    }
  }
}

// Aim for roughly this many bytes per chunk — big enough that chunk-object
// overhead and chunk count both stay small, small enough that no single
// allocation is itself a large fraction of the heap limit.
const TARGET_CHUNK_BYTES = 32_000_000;

function rowsPerChunkFor(genomeCount) {
  return Math.max(64, Math.floor(TARGET_CHUNK_BYTES / (genomeCount * 2)));
}

/**
 * Incrementally builds the same { presenceMatrix, geneIdsByGroup } shape as
 * buildMatrix, one row at a time, for streaming callers that don't have the
 * full row count up front. Each row's raw cell-text array is only ever
 * needed transiently in addRow() — unlike buildMatrix (handed every row's
 * raw strings already collected into one array), nothing here holds more
 * than one row's worth of raw text at a time. presenceMatrix itself is a
 * ChunkedPresenceMatrix (see above) rather than a single growable buffer.
 */
export class StreamingMatrixBuilder {
  constructor(genomeCount, rowsPerChunk = rowsPerChunkFor(genomeCount)) {
    this.genomeCount = genomeCount;
    this.presenceMatrix = new ChunkedPresenceMatrix(genomeCount, rowsPerChunk);
    this.geneIdsByGroup = [];
    this.groupCount = 0;
  }

  addRow(rawRow) {
    const rowIndex = this.groupCount;
    const entries = [];
    for (let genomeIndex = 0; genomeIndex < this.genomeCount; genomeIndex++) {
      const { copyCount, geneIds } = parsePresenceCell(rawRow[genomeIndex]);
      this.presenceMatrix.setCell(rowIndex, genomeIndex, copyCount);
      if (geneIds.length) entries.push([genomeIndex, geneIds.length === 1 ? geneIds[0] : geneIds]);
    }
    this.geneIdsByGroup[rowIndex] = finalizeGeneIdRow(entries, this.genomeCount);
    this.groupCount++;
  }

  /** Call once, after the last addRow(). */
  finish() {
    this.presenceMatrix.groupCount = this.groupCount;
    return {
      presenceMatrix: this.presenceMatrix,
      geneIdsByGroup: this.geneIdsByGroup,
    };
  }
}

function isChunked(presenceMatrix) {
  return presenceMatrix instanceof ChunkedPresenceMatrix;
}

export function copyCountAt(data, groupIndex, genomeIndex) {
  const pm = data.presenceMatrix;
  if (isChunked(pm)) return pm.get(groupIndex, genomeIndex);
  return pm[groupIndex * data.meta.genomeCount + genomeIndex];
}

export function presentAt(data, groupIndex, genomeIndex) {
  return copyCountAt(data, groupIndex, genomeIndex) > 0;
}

/** View of one group's copy counts across every genome, in genome order (zero-copy either way). */
export function presenceVector(data, groupIndex) {
  return rowView(data.presenceMatrix, groupIndex, data.meta.genomeCount);
}

/**
 * Same row view presenceVector() gives, but callable before a full
 * PangenomeData object exists (assemblePangenomeData in index.js builds
 * per-group stats from presenceMatrix before `data` itself is assembled).
 */
export function rowView(presenceMatrix, groupIndex, genomeCount) {
  if (isChunked(presenceMatrix)) return presenceMatrix.rowView(groupIndex);
  const base = groupIndex * genomeCount;
  return presenceMatrix.subarray(base, base + genomeCount);
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
  const pm = data.presenceMatrix;
  if (isChunked(pm)) {
    for (let g = 0; g < groupCount; g++) vector[g] = pm.get(g, genomeIndex);
  } else {
    for (let g = 0; g < groupCount; g++) vector[g] = pm[g * genomeCount + genomeIndex];
  }
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
