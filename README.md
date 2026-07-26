# Clann Pangenome Explorer

A free, browser-only tool for exploring pangenome outputs (Roary, Panaroo, PIRATE, PanACoTA) joined with CoinFinder co-occurrence results — the third tool in the Clann suite, alongside [Clann Tree Viewer](https://github.com/ChrisCreevey/clann-tree-viewer) and [Clann BLAST Explorer](https://github.com/ChrisCreevey/clann-blast-explorer).

Everything runs locally in your browser; nothing is uploaded to a server.

See [`CLAUDE.md`](CLAUDE.md) for the full design brief and [`clann-pangenome-explorer-BUILD-BRIEF.md`](clann-pangenome-explorer-BUILD-BRIEF.md) for the implementation plan.

## Status

**Phase 1 in progress** (parsers and common data model): Roary/Panaroo, PIRATE, and PanACoTA pangenome matrix parsers, a generic CSV/TSV fallback with column-mapping detection, and frequency-class assignment are implemented and tested. No UI yet — see the build brief's phase list for what's next.

## Development

No build step or dependencies required.

```
python3 -m http.server 8000
```

Run parser/analysis tests with Node's built-in test runner:

```
node --test
```
