// busy.js — the header spinner shown whenever a long synchronous
// computation is running (reading/parsing a large file, clustering,
// re-rendering after a mutation), so the page reads as "working" rather
// than "hung" — there's no hard cap stopping the user from choosing to
// wait on a big dataset; this is the honesty mechanism instead.
//
// Important limitation: this is plain single-threaded JS, not a Web
// Worker, so the computation itself still blocks the main thread — the
// rest of the page is genuinely unresponsive while it runs, and a very
// long computation can trigger the browser's own "Page Unresponsive"
// prompt. The spinner keeps animating through that regardless, because
// it's a pure CSS transform animation, which (in Chrome/Firefox) the
// compositor thread keeps ticking independently of the blocked main
// thread — but it's a "the tab is alive" signal, not a "you can still
// interact with anything" signal.
//
// runBusy(fn) defers `fn` by one tick (setTimeout 0) after showing the
// spinner, so the browser gets a chance to actually paint the
// now-visible spinner before the blocking work begins — without that,
// the show and the block would land in the same frame and nothing would
// ever be seen to change until it was already over.

let busyCount = 0;

function indicatorEl() {
  return document.getElementById("busyIndicator");
}

export function showBusy() {
  busyCount++;
  const el = indicatorEl();
  if (el) el.hidden = false;
}

export function hideBusy() {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) {
    const el = indicatorEl();
    if (el) el.hidden = true;
  }
}

/**
 * Run `fn` (synchronous) with the busy spinner shown for its duration.
 * Returns a Promise resolving to fn()'s return value, so callers can
 * `await runBusy(() => heavyWork())` alongside other async steps.
 */
export function runBusy(fn) {
  showBusy();
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      } finally {
        hideBusy();
      }
    }, 0);
  });
}
