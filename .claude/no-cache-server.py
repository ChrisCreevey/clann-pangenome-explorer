#!/usr/bin/env python3
"""Static file server for local dev preview that disables all caching.

Plain `python3 -m http.server` sends no Cache-Control header at all, which
lets Chrome apply its own heuristic caching to .js/.css files — meaning an
edit-then-reload cycle can silently serve a stale module with no error of
any kind. This wrapper adds Cache-Control: no-store to every response so a
page reload always reflects the current file on disk.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8934
    HTTPServer(("", port), NoCacheHandler).serve_forever()
