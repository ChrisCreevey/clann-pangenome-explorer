# Clann Pangenome Explorer

A free, browser-only tool for exploring pangenome outputs (Roary, Panaroo, PIRATE, PanACoTA) joined with gene annotations and CoinFinder co-occurrence results — the third tool in the Clann suite, alongside [Clann Tree Viewer](https://github.com/ChrisCreevey/clann-tree-viewer) and [Clann BLAST Explorer](https://github.com/ChrisCreevey/clann-blast-explorer).

**Live at [chriscreevey.github.io/clann-pangenome-explorer](https://chriscreevey.github.io/clann-pangenome-explorer/)**

Everything runs locally in your browser; nothing is uploaded to a server.

## What it's for

A typical pangenome project produces several files that only make sense once joined together: a pangenome matrix, one or two annotation tables, and a pair of CoinFinder co-occurrence files. This tool joins them by gene-group ID and gives you the summary views, filters, tagging, and visualisations needed to interpret the combined picture — including whether a category of genes you care about (AMR, virulence, or anything else you define) tends to co-occur or exclude other genes in the pangenome.

It does not run any pipeline itself — it explores output you've already generated.

## Inputs at a glance

| Input | Required for | Accepted formats |
|---|---|---|
| Pangenome matrix | Everything | Roary/Panaroo `gene_presence_absence.csv`, PIRATE `PIRATE.gene_families.tsv`, a PanACoTA matrix, or any CSV/TSV with a group-ID column and one column per genome (manual column mapping if auto-detection can't tell) |
| Annotation table | Annotation-based filtering, keyword tagging, category summaries | One row per gene group (direct join), **or** one row per gene across every genome (rolled up to a per-group consensus) |
| Category tag list | Category filters/summaries without typing keywords | Two-column CSV/TSV: group ID, category |
| CoinFinder associated pairs | Pair table, category matrix, network graph | CoinFinder's significantly-associated-pairs output |
| CoinFinder disassociated pairs | Same as above | CoinFinder's significantly-disassociated-pairs output |

All file inputs also accept `.gz`/`.zip` compressed versions, decompressed entirely in your browser.

## Analyses, and what each one needs

### Pangenome summary
*Needs only the pangenome matrix.*
- Frequency-class counts (core / soft-core / shell / cloud) as a donut chart and table, with **user-adjustable thresholds** (defaults to Roary's convention: core ≥99%, soft-core ≥95%, shell ≥15%; changing one cascades the others below it automatically so the ordering always holds)
- Gene frequency spectrum — a histogram of how many genomes each group is found in
- Per-genome bar chart (total / unique / core genes present) for spotting an outlier genome

### Presence/absence heatmap and accumulation curves
*Needs only the pangenome matrix.*
- Canvas-rendered heatmap, sortable by frequency class or by a lightweight similarity clustering, zoomable and pannable, exportable as PNG or SVG
- Pangenome and core-genome accumulation curves from random genome-subsampling permutations (capped and flagged as approximate for large genome counts)

### Filtering and top-hit workflows
*Needs only the pangenome matrix* (annotation and tags add more filter criteria if loaded).
- Filter by frequency class, presence/sequence counts, average copies per genome, annotation text, or category tag — live, with Undo/Reset
- Presence/absence pattern matching against a genome subset you define
- Two-group comparison: split genomes into two sets and rank groups by presence difference (a plain contingency table and odds ratio, explicitly descriptive rather than a formal significance test)
- Singleton (genome-unique) groups and multi-copy gene-family candidates, surfaced directly

### Annotation mapping and category tagging
*Needs the pangenome matrix plus an annotation table (for annotation-based views) and/or a keyword or tag list (for category tags).*
- **Workflow A** — one annotation row per gene group, joined directly
- **Workflow B** — one row per gene across every genome, rolled up to a per-group consensus (majority annotation) with a consistency score and a full disagreement breakdown, subject to a configurable minimum count/percentage
- Keyword tagging — type term(s) to match against annotation text (e.g. `beta-lactamase`, `efflux` for an ad hoc AMR tag)
- List-upload tagging — a two-column group-ID/category file from a dedicated tool (CARD/RGI, a VFDB search, etc.); a group can carry more than one tag

### CoinFinder integration
*Needs the pangenome matrix plus both CoinFinder pair files; category tags make the category views meaningful.*
- Pair table: every associated/disassociated pair, each side annotated with its own group's annotation, frequency class, and tags — sortable/filterable by direction, significance, and category
- Category-by-category matrix: associated/disassociated pair counts by category combination (AMR–AMR, AMR–virulence, AMR–uncategorised, etc.)
- Network graph: nodes are gene groups (coloured by category, or frequency class if no tags are defined), edges are pairs styled by direction, pannable/zoomable, exportable as SVG
- Unmatched pairs (a naming mismatch between CoinFinder's input and the loaded pangenome) are reported, never silently dropped
- One-click "cross-category pairs only" and "sort by significance, ignore category" views — for noticing an association you weren't specifically looking for

### Staging data for downstream work
*Needs only the pangenome matrix; richer with tags/annotation loaded.*
- Per-group detail card: annotation, consistency score and disagreement breakdown, tags, frequency class, counts, and a collapsible list of constituent gene IDs by genome
- Export constituent gene IDs (a selected group or the current filtered set) as a flat list, ready for sequence extraction from a genomes FASTA/GFF set
- Export the multi-copy/gene-family candidate list, or a filtered CoinFinder pair table, as CSV/TSV
- Cross-links to [Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/) (extract sequences, explore hits) and [Clann Tree Viewer](https://chriscreevey.github.io/clann-tree-viewer/) (align and build a tree) from every export surface

## Performance and scale

Presence/absence data is stored as a flat typed array (2 bytes per group-per-genome cell) rather than one object per cell, and the accumulation-curve computation avoids rescanning every group at every step. Measured directly in-browser, not estimated:

| Dataset | File size | Peak memory | Parse | Render | Total |
|---|---|---|---|---|---|
| 30 genomes × 250 groups (the bundled example) | 140 KB | negligible | instant | instant | instant |
| 10,000 genomes × 2,000 groups | 31 MB | 174 MB | 0.55s | 2.2s | ~2.7s |
| 10,000 genomes × 20,000 groups | 310 MB | ~1.6 GB | 5.2s | 6.5s | ~11.7s |

For reference, the 10,000×20,000 case previously required an estimated >11GB of heap and took ~30s just to render (before the accumulation-curve computation was optimised) — combined, it would have crashed most browser tabs outright. Once loaded, filtering, tagging, and sorting stay fast (tens of milliseconds) regardless of dataset size, since none of those operations re-touch the full matrix.

The practical ceiling is still the browser tab's own memory limit (commonly ~4GB) rather than any limit in the code — a dataset roughly an order of magnitude past the numbers above (tens of thousands of genomes with a large accessory genome) is where memory, not computation time, would likely become the binding constraint.
