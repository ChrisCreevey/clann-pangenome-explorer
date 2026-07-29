// stream-lines.js — read a File as a sequence of lines without ever holding
// the whole file as one JS string. Needed because file.text() on a
// multi-gigabyte file can hit the browser's memory limit and, worse, some
// engines resolve that failure as an empty string rather than throwing —
// so a naive "read it all, then split on newlines" approach can silently
// produce zero data instead of an error.
//
// Memory stays bounded to one chunk (from file.stream()) plus at most one
// pending partial line, regardless of total file size.

/** Async generator yielding each line of `file` (newline stripped), UTF-8 decoded incrementally. */
export async function* readLines(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const lineEnding = /\r\n|\r|\n/;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let match;
      while ((match = lineEnding.exec(buffer))) {
        yield buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode(); // flush any trailing partial multi-byte sequence
  if (buffer.length) yield buffer;
}

/**
 * Peek at the start of a file without reading it in full — used to detect
 * format/delimiter from the header line alone. Grows the read window if no
 * line ending is found (a very wide header), up to `maxBytes`.
 */
export async function peekFirstLine(file, maxBytes = 8_000_000) {
  let windowSize = 65_536;
  while (windowSize <= maxBytes) {
    const chunk = await file.slice(0, windowSize).text();
    const match = chunk.match(/\r\n|\r|\n/);
    if (match) return chunk.slice(0, match.index);
    if (windowSize >= file.size) return chunk; // whole file is shorter than the window
    windowSize *= 8;
  }
  return (await file.slice(0, maxBytes).text());
}
