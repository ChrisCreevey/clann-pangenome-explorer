// compressed.js — transparently accept gzip- or zip-compressed uploads
// (pangenome matrix, annotation, CoinFinder pair files), decompressing
// entirely client-side with native browser APIs. No dependencies, nothing
// leaves the browser. Ported unchanged from clann-blast-explorer/src/parse/compressed.js.

function looksLikeGzip(bytes) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Search backward for the End Of Central Directory record (tolerates a trailing zip comment). */
function findEndOfCentralDirectory(bytes) {
  const EOCD_SIG = 0x06054b50;
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, bytes.length - 22 - maxCommentLen);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, 22);
    if (view.getUint32(0, true) === EOCD_SIG) {
      return {
        totalEntries: view.getUint16(10, true),
        centralDirOffset: view.getUint32(16, true),
      };
    }
  }
  return null;
}

/**
 * Read the Zip64 "extended information" extra field (id 0x0001), if
 * present, for whichever of {uncompressedSize, compressedSize,
 * localHeaderOffset} were pinned at the 0xFFFFFFFF placeholder in the
 * main 32-bit fields. Per the zip spec, only the overflowing fields are
 * present, always in this fixed order — the standard 32-bit fields are
 * left untouched for the fields that already fit.
 */
function readZip64Extra(bytes, extraStart, extraFieldLength, needs) {
  const result = { uncompressedSize: null, compressedSize: null, localHeaderOffset: null };
  let pos = extraStart;
  const end = extraStart + extraFieldLength;
  while (pos + 4 <= end) {
    const header = new DataView(bytes.buffer, bytes.byteOffset + pos, 4);
    const id = header.getUint16(0, true);
    const size = header.getUint16(2, true);
    if (id === 0x0001) {
      const data = new DataView(bytes.buffer, bytes.byteOffset + pos + 4, size);
      let off = 0;
      const readUint64 = () => {
        const low = data.getUint32(off, true);
        const high = data.getUint32(off + 4, true);
        off += 8;
        // Safe for realistic file sizes (well under Number.MAX_SAFE_INTEGER).
        return high * 4294967296 + low;
      };
      if (needs.uncompressedSize && off + 8 <= size) result.uncompressedSize = readUint64();
      if (needs.compressedSize && off + 8 <= size) result.compressedSize = readUint64();
      if (needs.localHeaderOffset && off + 8 <= size) result.localHeaderOffset = readUint64();
      break;
    }
    pos += 4 + size;
  }
  return result;
}

/** List every file entry in a ZIP archive's central directory. */
export function listZipEntries(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  if (!eocd) throw new Error("Not a valid ZIP archive (no end-of-central-directory record found).");
  const decoder = new TextDecoder();
  const entries = [];
  let offset = eocd.centralDirOffset;
  for (let i = 0; i < eocd.totalEntries; i++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 46);
    if (view.getUint32(0, true) !== 0x02014b50) break; // central file header signature
    const compressionMethod = view.getUint16(10, true);
    let compressedSize = view.getUint32(20, true);
    let uncompressedSize = view.getUint32(24, true);
    const fileNameLength = view.getUint16(28, true);
    const extraFieldLength = view.getUint16(30, true);
    const fileCommentLength = view.getUint16(32, true);
    let localHeaderOffset = view.getUint32(42, true);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));

    // Zip64: any of the three 32-bit fields above pinned at 0xFFFFFFFF has
    // its real value in a Zip64 extra field instead. Some zip writers
    // (notably macOS's Archive Utility / Finder "Compress") emit this
    // defensively for large single files even well under the 4GB size that
    // strictly requires it, so this isn't just a >4GB-archive concern.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const zip64 = readZip64Extra(bytes, nameStart + fileNameLength, extraFieldLength, {
        uncompressedSize: uncompressedSize === 0xffffffff,
        compressedSize: compressedSize === 0xffffffff,
        localHeaderOffset: localHeaderOffset === 0xffffffff,
      });
      if (zip64.uncompressedSize != null) uncompressedSize = zip64.uncompressedSize;
      if (zip64.compressedSize != null) compressedSize = zip64.compressedSize;
      if (zip64.localHeaderOffset != null) localHeaderOffset = zip64.localHeaderOffset;
    }

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameStart + fileNameLength + extraFieldLength + fileCommentLength;
  }
  return entries;
}

/** Extract one ZIP entry's decompressed bytes. */
export async function extractZipEntry(bytes, entry) {
  const localView = new DataView(bytes.buffer, bytes.byteOffset + entry.localHeaderOffset, 30);
  if (localView.getUint32(0, true) !== 0x04034b50) throw new Error("Corrupt ZIP local file header.");
  const nameLen = localView.getUint16(26, true);
  const extraLen = localView.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed; // stored, no compression
  if (entry.compressionMethod === 8) return inflateRaw(compressed);
  throw new Error(`Unsupported ZIP compression method (${entry.compressionMethod}) — only "stored" and "deflate" are supported.`);
}

/**
 * If `file` is gzip- or zip-compressed (detected by magic bytes, not
 * extension), decompress it and return { text, filename } with the
 * compression wrapper's name stripped. Otherwise returns null — the caller
 * should read the file as plain text itself.
 */
export async function decompressIfNeeded(file) {
  // Sniff just the first few bytes so an uncompressed multi-GB file isn't
  // read into memory twice (once here, once by the caller's plain-text
  // fallback) just to discover it isn't gzip/zip.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());

  if (looksLikeGzip(head)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const out = await gunzip(bytes);
    return { text: new TextDecoder().decode(out), filename: file.name.replace(/\.gz$/i, "") };
  }

  if (looksLikeZip(head)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Skip directory entries and macOS's AppleDouble metadata files
    // (__MACOSX/._real-file.csv) — Finder/Archive Utility adds one of
    // these alongside every real file it zips, and it would otherwise be
    // able to win the "first .csv/.tsv/.tab/.txt match" pick below.
    const entries = listZipEntries(bytes).filter((e) => !e.name.endsWith("/") && !/(^|\/)__MACOSX\//.test(e.name));
    if (!entries.length) throw new Error("This ZIP archive has no files in it.");
    const chosen = entries.find((e) => /\.(csv|tsv|tab|txt)$/i.test(e.name)) || entries[0];
    const out = await extractZipEntry(bytes, chosen);
    return { text: new TextDecoder().decode(out), filename: chosen.name.split("/").pop() };
  }

  return null;
}
