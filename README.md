# Clann Pangenome Explorer

A free, browser-only tool for exploring pangenome outputs (Roary, Panaroo, PIRATE, PanACoTA) joined with CoinFinder co-occurrence results — the third tool in the Clann suite, alongside [Clann Tree Viewer](https://github.com/ChrisCreevey/clann-tree-viewer) and [Clann BLAST Explorer](https://github.com/ChrisCreevey/clann-blast-explorer).

Everything runs locally in your browser; nothing is uploaded to a server.

See [`CLAUDE.md`](CLAUDE.md) for the full design brief and [`clann-pangenome-explorer-BUILD-BRIEF.md`](clann-pangenome-explorer-BUILD-BRIEF.md) for the implementation plan.

## Status

All 8 build phases are complete: pangenome parsers (Roary/Panaroo, PIRATE, PanACoTA, generic CSV/TSV fallback), the pangenome summary (frequency classes, frequency spectrum, per-genome counts), a zoomable presence/absence heatmap and accumulation curves, filtering/top-hit workflows, annotation mapping and category tagging, CoinFinder pair/network integration, export and staging, and site chrome (meta tags, About & FAQ, sitemap/robots.txt). See [`clann-pangenome-explorer-BUILD-BRIEF.md`](clann-pangenome-explorer-BUILD-BRIEF.md) for the phase-by-phase detail and the resolved open points.

## Development

No build step or dependencies required.

```
python3 -m http.server 8000
```

Run parser/analysis tests with Node's built-in test runner:

```
node --test
```
