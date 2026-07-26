// download-util.js — trigger a browser download of an in-memory string.
// Shared by every export button; the export/*.js modules only build the
// text, they don't touch the DOM.

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
