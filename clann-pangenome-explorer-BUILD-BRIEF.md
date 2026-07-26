# Clann Pangenome Explorer — Build Brief for Claude Code

This document specifies a standalone, browser-only web app for exploring pangenome outputs (Roary, Panaroo, PIRATE, PanACoTA) joined with CoinFinder co-occurrence results, to be hosted on GitHub Pages as the third tool in the Clann suite, alongside [Clann Tree Viewer](https://github.com/ChrisCreevey/clann-tree-viewer) and [Clann BLAST Explorer](https://github.com/ChrisCreevey/clann-blast-explorer). It follows those projects' conventions directly. Read this brief and `CLAUDE.md` in full before starting, and treat both sibling repositories as the reference implementation for style, structure, and tone — `clann-blast-explorer` in particular, since its build brief and code are the closest structural analogue (tabular import → column-mapping fallback → derived analysis → hand-rolled SVG charts → export).

## 1. Purpose and audience

Students who ran a pangenome pipeline and CoinFinder and now have several disconnected output files (a pangenome matrix, one or two annotation tables, an associated/disassociated pair file) and need to join them and interpret the result — in particular, whether genes of a tagged category (AMR, virulence, or any other) tend to co-occur or exclude one another. The tool joins by gene-group ID, summarises, filters, tags, and visualises. It does not run any pipeline itself.

## 2. Non-negotiable constraints

Carried over directly from `clann-tree-viewer` and `clann-blast-explorer`:

- **Browser-only, no backend.** Everything runs client-side. Nothing is uploaded to a server. State this explicitly in the UI, same phrasing as the sibling tools.
- **No build step.** Plain ES modules, no bundler, no framework.
- **No external runtime dependencies.** No CDN-loaded libraries. Charts, heatmap, and network graph are hand-written SVG/Canvas.
- **GPL-2.0 licence**, matching both sibling repos.
- **GitHub Pages hosting** at `chriscreevey.github.io/clann-pangenome-explorer/`.
- **Theme-aware light/dark styling**, porting the CSS variable approach from `styles/explorer.css`/`styles/viewer.css` rather than inventing a new palette.

## 3. Repository layout

Mirror `clann-blast-explorer`'s layout, substituting content:

```
index.html                 App shell
styles/pangenome.css        Styles (theme-aware; port variables from explorer.css)
src/
  app.js                    Upload glue: File(s) → parse() → mountExplorer()
  pangenome.js               Interactive UI orchestrator: mountExplorer(container, data)
  parse/
    roary.js                 gene_presence_absence.csv (Roary/Panaroo-compatible)
    pirate.js                 PIRATE.gene_families.tsv (allele-level → group rollup)
    panacota.js                Family x genome 0/1 or copy-count matrix
    generic-matrix.js          Fallback CSV/TSV importer with column-mapping preview
    annotation.js               Workflow A (per-group) and Workflow B (per-gene, consensus rollup)
    coinfinder.js                 Associated/disassociated pair files, column-mapping fallback
    compressed.js                 .gz/.zip (port directly from clann-blast-explorer/src/parse/compressed.js)
    index.js                      detectFormat() + parse() → PangenomeData
  analysis/
    frequency.js               Frequency-class assignment, frequency spectrum
    accumulation.js             Pangenome/core accumulation curves (subsampling)
    clustering.js                 Lightweight heatmap row/column clustering
    topfilter.js                  Filter/sort, pattern matching, two-group comparison (odds ratio), singleton/multi-copy detection
    tags.js                        Keyword tagging, list-upload tagging
    pairs.js                        Pair resolution against groups, category-by-category matrix, unexpected-pair scoring
  render/
    heatmap.js                    Presence/absence heatmap (Canvas, zoomable)
    spectrum-chart.js              Frequency spectrum + accumulation curve charts (SVG)
    genome-bar-chart.js            Per-genome gene-count bar chart (SVG)
    category-chart.js              Category summary + category-by-category matrix (SVG)
    pair-table.js                   Sortable/filterable pair table
    network-graph.js                 Association/disassociation network graph (SVG, pan/zoom)
    column-mapping.js                 Port directly from clann-blast-explorer
export/
  group-export.js              Constituent gene ID list, multi-copy candidate list
  pair-export.js                 Filtered pair table CSV/TSV
  svg-export.js                    Heatmap/network SVG/PNG export
examples/                     Sample pangenome/annotation/CoinFinder files (see §9b, placeholder)
test/                         Fixture-driven parser and analysis tests
.github/                      (mirror sibling repos' workflow files if present)
sitemap.xml
robots.txt
og-image.png / og-image.svg
LICENSE                      GPL-2.0
README.md
```

Keep `PangenomeData` as the single internal document shape every renderer consumes, exactly as `ExplorerData` works in BLAST Explorer — parsers' only job is to turn uploaded files into that shape.

## 4. Data model

Sketch (finalise field names during implementation, but keep this shape):

```js
PangenomeData = {
  meta: {
    sourceFilename, format,        // 'roary' | 'panaroo' | 'pirate' | 'panacota' | 'generic-matrix'
    genomeCount, groupCount,
    freqClassThresholds,           // { core: 99, softcore: 95, shell: 15 }, user-adjustable, Roary defaults
    annotationWorkflow,             // 'A' | 'B' | null
  },
  genomes: [ { name, totalGenes, uniqueGenes, coreGenesPresent } ],   // last three derived
  groups: [
    {
      groupId, representativeId,
      annotation, consensusAnnotation, consistencyScore,   // consensus/score only for workflow B
      annotationBreakdown,           // full frequency table of distinct annotations, workflow B only
      tags: [ 'AMR', 'virulence', ... ],
      freqClass,                     // derived: 'core' | 'softcore' | 'shell' | 'cloud'
      genomesPresentIn, sequencesTotal, avgCopiesPerGenome,   // derived
      cells: { [genomeName]: { copyCount, geneIds: [...] } },
    },
    // ...
  ],
  pairs: [
    {
      groupIdA, groupIdB, direction,   // 'associated' | 'disassociated'
      significance,
      resolvedA, resolvedB,             // references into groups[]; null if unmatched
    },
    // ...
  ],
  unmatchedPairs: [ /* pairs referencing a group ID not found in groups[], reported not dropped */ ],
}
```

PIRATE's allele-level columns do not map 1:1 onto this per-genome/per-group cell shape — `parse/pirate.js` is responsible for rolling allele calls up into `cells` before anything downstream sees the data; no other module should know PIRATE has a different native shape.

## 5. Input handling and parsing

- Accept file picker, drag-and-drop, and paste-into-window, matching the sibling tools' interaction pattern exactly.
- Auto-detect Roary/Panaroo by filename (`gene_presence_absence.csv`, `gene_presence_absence_roary.csv`) and header shape; detect PIRATE by the `PIRATE.gene_families.tsv` name and `threshold%` column; detect PanACoTA by a plain family x genome 0/1 matrix without Roary's metadata columns.
- Fall back to the generic CSV/TSV importer whenever detection fails or is ambiguous: preview first rows, best-guess the group-ID column and which columns are genomes, and require user confirmation before loading — never guess silently, same principle as BLAST Explorer's headerless-file handling.
- Annotation import: detect workflow A (one row per group) vs workflow B (one row per gene, genome column present) by row count relative to group count; route B through the consensus rollup in `parse/annotation.js` before groups are considered annotated.
- CoinFinder import: route both association and disassociation files through the same generic column-mapping step, with best-guess defaults for the two gene-ID columns and the significance column (CoinFinder's exact column names vary by version).
- Resolve every pair's gene IDs against already-loaded groups; anything that fails to match goes into `unmatchedPairs` and is surfaced in the UI (count + downloadable list), never silently dropped.
- Multi-genome files are the default case. Every view must work sensibly whether the file contains a handful of genomes or several hundred — the heatmap and network graph in particular need to stay responsive at 400 genomes x thousands of groups, so use Canvas (not per-cell SVG nodes) for the heatmap and cap/virtualize the network graph's rendered node count with a warning when it's exceeded.

## 6. Features

Build in the phases below, matching `CLAUDE.md`'s suggested build phases. Each phase should be a working, demoable state.

### Phase 1 — Parsers and common data model
- Roary/Panaroo/PIRATE/PanACoTA parsers plus generic CSV/TSV fallback with column-mapping preview
- `PangenomeData` construction, frequency-class assignment with adjustable thresholds (defaults: core >=99%, softcore 95–99%, shell 15–95%, cloud <15%)

### Phase 2 — Pangenome summary
- Frequency-class donut/bar chart plus plain table
- Gene frequency spectrum histogram (most informative single plot — prioritise this)
- Per-genome bar chart: total/unique/core-present genes, for spotting outlier genomes

### Phase 3 — Heatmap and accumulation curves
- Presence/absence heatmap: Canvas-rendered, sortable by frequency and by lightweight client-side clustering, zoomable, exportable as SVG/PNG
- Pangenome and core-genome accumulation curves via client-side random subsampling permutations, capped and labelled as approximate above a configurable genome count

### Phase 4 — Filtering and top-hit workflows
- Filter/sort by frequency class, isolate/sequence counts, avg copies per isolate, annotation text, category tag
- Presence/absence pattern matching against a defined genome subset
- Two-group comparison: 2x2 contingency table + odds ratio, explicitly labelled descriptive, not a formal test
- Singleton/unique-per-genome surfacing
- Multi-copy family detection above a configurable threshold, with export hook for downstream Clann multi-copy supertree work

### Phase 5 — Annotation mapping and category tagging
- Workflow A direct join; Workflow B consensus rollup with configurable min-count/min-percentage acceptance threshold and a full disagreement-breakdown view per group
- Keyword tagging (match term(s) against annotation text)
- List-upload tagging (two-column group-ID/category file)

### Phase 6 — CoinFinder integration
- Pair table: both sides annotated with annotation, frequency class, category tags; sortable/filterable by direction, significance, category, frequency class
- Category-by-category association/disassociation matrix (AMR-AMR, AMR-virulence, AMR-uncategorised, etc.)
- Network graph: nodes = groups (coloured by category, or frequency class if no categories defined), edges = pairs (styled by direction), filterable by category/direction/significance, pan/zoom, SVG export
- Unexpected-pair surfacing: one-click cross-category highlight (from pair table and network graph), and one-click pure-significance sort ignoring category — this is the highest-attention module per `CLAUDE.md`, budget accordingly
- Unmatched-pair reporting, and graceful, filterable handling of pairs referencing an uncategorised/unannotated group (not hidden as missing data)

### Phase 7 — Export and staging
- Per-group detail card (ID, annotation + consistency score, tags, freq class, counts, collapsible per-genome gene ID list)
- Constituent gene ID export for a selected group or filtered set
- Multi-copy/gene-family candidate export (naming: see §9c)
- Filtered pair table export (CSV/TSV) and network view export (SVG/PNG)
- Cross-links to BLAST Explorer and Tree Viewer from the export panel

### Phase 8 — Site chrome and polish
- Meta tags (Open Graph, Twitter card, JSON-LD `WebApplication` + `FAQPage`, matching sibling repos' pattern), `og-image.png`
- Footer: `Feedback` / `GitHub` / `★ Like it?`, same phrasing as sibling tools
- About & FAQ section below the fold
- `sitemap.xml`, `robots.txt`, canonical URL
- Responsive layout pass, resizable panels

## 7. UI/UX conventions to replicate exactly

- Header: persistent tool name top-left ("Clann Pangenome Explorer"), current file name(s) beside it
- Collapsible sidebar control panel (filters, tagging, thresholds); main canvas/table area; theme toggle; resizable panel width (`#sideResize` drag handle, double-click to reset)
- Drag-and-drop target with the same visual treatment as the sibling tools
- Undo/Reset on the filter panel, matching BLAST Explorer's `fUndo`/`fReset` pattern
- Same footer link set and phrasing: `Feedback` (GitHub issues new), `GitHub` (source), `★ Like it?` (star the repo)
- Same landing-page structure: short description, format badges (Roary/Panaroo/PIRATE/PanACoTA/CoinFinder + `.gz`/`.zip`), "Open file…" button, About & FAQ below the fold

## 8. What this tool explicitly does not do

State clearly in the README and on the page itself:

- Does not run Roary, Panaroo, PIRATE, PanACoTA, CoinFinder, Prokka, Bakta, or any other pipeline
- Does not run BLAST/DIAMOND or any sequence search (stages IDs for Clann BLAST Explorer instead)
- Does not build alignments or phylogenetic trees (stages IDs for Clann Tree Viewer instead)
- Does not annotate any sequence automatically
- Does not perform formal statistical testing beyond simple, clearly labelled descriptive measures (e.g. odds ratio, not a significance test)
- Does not upload any data anywhere

## 9. Outstanding items — resolved defaults and placeholders

`CLAUDE.md` left several points open. Resolved defaults below so implementation isn't blocked; flag each with a `// TODO:` marker at the point of use so they're easy to revisit, per the sibling repos' convention.

- **§9a. Frequency-class thresholds.** Default to Roary's convention (core >=99%, softcore 95–99%, shell 15–95%, cloud <15%), user-adjustable per session via the sidebar, not persisted between sessions. `// TODO: confirm whether thresholds should persist across sessions (localStorage) — currently session-only.`
- **§9b. Example data.** `examples/` needs a small synthetic Roary-style matrix, a synthetic annotation table (both workflow A and B variants), and a synthetic CoinFinder associated/disassociated pair, clearly labelled synthetic. Generate placeholders to unblock Phases 1–6; swap in real files if supplied later.
- **§9c. Multi-copy/gene-family export naming.** No confirmed Clann-consistent term yet — use `multicopy-candidates.csv` for now. `// TODO: confirm naming convention against Clann's own documentation before release.`
- **§9d. Category tag hierarchy.** Build as a flat label set (a group can hold multiple tags) rather than a parent/child hierarchy, for simplicity and to match the brief's lightweight tagging intent. `// TODO: revisit if a hierarchy (e.g. broad "AMR" + mechanism sub-tags) is requested.`
- **§9e. Two-group comparison statistic.** Odds ratio only, explicitly labelled "descriptive, not a significance test" in the UI immediately beside the value — no p-value or confidence interval by default, consistent with the brief's "out of scope: formal statistical testing" constraint.
- **§9f. Unexpected-pair weighting.** Keep the two lenses (cross-category highlight, pure-significance sort) as separate, equally-weighted, one-click views rather than a single blended score — avoids baking in a judgement call about which matters more, and lets the student compare both directly.

## 10. Development and testing

- No build step: `python3 -m http.server 8000`, then open `index.html`
- Fixture-driven tests (`node --test`) covering: each of the four pangenome-matrix formats, the generic fallback with ambiguous columns, workflow A vs B annotation import (including a low-consistency group), CoinFinder pair import with intentionally mismatched/unmatched IDs, `.gz`/`.zip` decompression
- Fixture-driven tests for derived analysis: frequency-class assignment at boundary values, odds-ratio calculation, multi-copy threshold detection, category-by-category matrix counts, unexpected-pair filtering
- Fixture-driven tests for the accumulation-curve subsampling (deterministic under a seeded RNG, so tests aren't flaky)

## 11. Reference implementation

Treat `https://github.com/ChrisCreevey/clann-blast-explorer` as the primary structural reference (closest analogue: tabular import, column-mapping fallback, derived analysis modules, hand-rolled SVG/Canvas charts, export panel) and `https://github.com/ChrisCreevey/clann-tree-viewer` as the reference for the base site chrome and interactive-canvas conventions (pan/zoom, SVG export). When in doubt about a UI or architectural decision not covered explicitly above, match what those repositories do.
