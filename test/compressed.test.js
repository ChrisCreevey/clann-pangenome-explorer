import { test } from "node:test";
import assert from "node:assert/strict";

import { listZipEntries, extractZipEntry, decompressIfNeeded } from "../src/parse/compressed.js";

/**
 * Hand-build a minimal multi-entry ZIP archive (method 0 = "stored", no
 * real deflate needed) so the byte-level parsing can be tested without a
 * real compression library. Per entry, `zip64: true` forces the central
 * directory's size fields to the 0xFFFFFFFF placeholder and appends a
 * Zip64 extra field with the real values, mirroring what macOS's Archive
 * Utility / Finder "Compress" is known to emit even for files well under
 * the 4GB size that strictly requires it (the bug this file guards against).
 */
function buildZip(entrySpecs) {
  const parts = [];
  const centralRecords = [];
  let offset = 0;

  for (const { name, content, zip64 = false } of entrySpecs) {
    const nameBytes = new TextEncoder().encode(name);
    const contentBytes = new TextEncoder().encode(content);
    const localHeaderOffset = offset;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // no local extra field
    local.set(nameBytes, 30);

    const zip64Extra = zip64
      ? (() => {
          const buf = new Uint8Array(4 + 16); // header (id+size) + uncompressedSize + compressedSize
          const v = new DataView(buf.buffer);
          v.setUint16(0, 0x0001, true); // Zip64 extended information id
          v.setUint16(2, 16, true); // 2 x 8-byte fields follow
          v.setUint32(4, contentBytes.length, true); // uncompressedSize low
          v.setUint32(8, 0, true); // uncompressedSize high
          v.setUint32(12, contentBytes.length, true); // compressedSize low
          v.setUint32(16, 0, true); // compressedSize high
          return buf;
        })()
      : new Uint8Array(0);

    const central = new Uint8Array(46 + nameBytes.length + zip64Extra.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central file header signature
    cv.setUint16(10, 0, true); // compression method: stored
    cv.setUint32(20, zip64 ? 0xffffffff : contentBytes.length, true); // compressedSize
    cv.setUint32(24, zip64 ? 0xffffffff : contentBytes.length, true); // uncompressedSize
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, zip64Extra.length, true);
    cv.setUint16(32, 0, true); // file comment length
    // Realistic case: only the sizes overflow 32 bits (a small archive with
    // a hugely compressible large entry) — offsets stay small regardless.
    cv.setUint32(42, localHeaderOffset, true); // local header offset
    central.set(nameBytes, 46);
    central.set(zip64Extra, 46 + nameBytes.length);

    parts.push(local, contentBytes);
    centralRecords.push(central);
    offset += local.length + contentBytes.length;
  }

  const centralDirOffset = offset;
  for (const central of centralRecords) { parts.push(central); offset += central.length; }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(10, entrySpecs.length, true); // total entries
  ev.setUint32(16, centralDirOffset, true); // central directory offset
  parts.push(eocd);

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { bytes.set(p, pos); pos += p.length; }
  return bytes;
}

function buildStoredZip(name, content, opts = {}) {
  return buildZip([{ name, content, ...opts }]);
}

test("listZipEntries reads a plain (non-zip64) entry correctly", () => {
  const bytes = buildStoredZip("data.csv", "a,b\n1,2\n");
  const entries = listZipEntries(bytes);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "data.csv");
  assert.equal(entries[0].compressedSize, 8);
  assert.equal(entries[0].uncompressedSize, 8);
});

test("listZipEntries reads real sizes from the Zip64 extra field when the 32-bit fields are the 0xFFFFFFFF placeholder", () => {
  const content = "group_id,G1,G2\ngrp1,1,0\n";
  const bytes = buildStoredZip("gene_presence_absence.csv", content, { zip64: true });
  const entries = listZipEntries(bytes);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].compressedSize, content.length);
  assert.equal(entries[0].uncompressedSize, content.length);
  assert.equal(entries[0].localHeaderOffset, 0);
});

test("extractZipEntry recovers the full content for a Zip64-flagged entry (the bug this guards: without the fix, size reads as ~4GB and the wrong byte range is sliced)", async () => {
  const content = "group_id,G1,G2\ngrp1,1,0\ngrp2,0,1\n";
  const bytes = buildStoredZip("gene_presence_absence.csv", content, { zip64: true });
  const [entry] = listZipEntries(bytes);
  const out = await extractZipEntry(bytes, entry);
  assert.equal(new TextDecoder().decode(out), content);
});

test("decompressIfNeeded end-to-end recovers a Zip64-flagged entry via a real File object", async () => {
  const content = "group_id,G1,G2\ngrp1,1,0\ngrp2,0,1\n";
  const bytes = buildStoredZip("gene_presence_absence.csv", content, { zip64: true });
  const file = new File([bytes], "gene_presence_absence.csv.zip");
  const result = await decompressIfNeeded(file);
  assert.equal(result.filename, "gene_presence_absence.csv");
  assert.equal(result.text, content);
});

test("decompressIfNeeded skips __MACOSX AppleDouble metadata even when it's listed before the real file", async () => {
  const content = "group_id,G1,G2\ngrp1,1,0\ngrp2,0,1\n";
  const bytes = buildZip([
    { name: "__MACOSX/._gene_presence_absence.csv", content: "\x00\x05junk-resource-fork-bytes" },
    { name: "gene_presence_absence.csv", content, zip64: true },
  ]);
  const file = new File([bytes], "archive.zip");
  const result = await decompressIfNeeded(file);
  assert.equal(result.filename, "gene_presence_absence.csv");
  assert.equal(result.text, content);
});
