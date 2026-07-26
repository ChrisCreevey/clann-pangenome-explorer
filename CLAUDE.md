# Clann Pangenome Explorer — design brief for Claude Code

## Purpose

This document specifies a browser-only web app for exploring pangenome outputs (Roary, Panaroo, PIRATE, PanACoTA) and associated CoinFinder co-occurrence results, to be hosted on GitHub Pages. It is the third tool in the Clann suite, alongside [Clann Tree Viewer](https://chriscreevey.github.io/clann-tree-viewer/) and [Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/), and should match those two in architecture, aesthetic, and site conventions.

The tool's central job is integration. A typical student project produces several disconnected output files: a pangenome matrix, one or two annotation tables, and a pair of CoinFinder association/disassociation files. Each file makes sense on its own but the biological interpretation only emerges once they are brought together, for example asking whether the AMR genes and virulence genes in this species tend to co-occur. The tool exists to join these files by gene-group ID, let the student explore the combined picture, and surface patterns worth a closer look, including unexpected ones that were not part of the original hypothesis.

Primary audience: undergraduate students working through this project. Secondary audience: researchers staging data for further work. The tool does not run any pipeline itself. It parses existing output files, joins them, summarises and visualises the result, and exports subsets for downstream use, matching the "stage data, don't build it" philosophy of Clann BLAST Explorer.

## The underlying study, and where the tool fits

The typical project this tool supports runs as follows:

1. Gather 200-400 genomes of a species and annotate each one (Prokka or Bakta).
2. Run a pangenome analysis (Roary, Panaroo, PIRATE, or PanACoTA), identifying a representative sequence for each gene group.
3. Annotate the representatives with specialised tools, producing a CSV/TSV of annotations keyed to representative sequences. A more thorough variant annotates every gene in every genome instead, and maps the result back to groups.
4. Run CoinFinder on the pangenome to find significantly associated and significantly disassociated gene pairs, producing two output files.
5. Interpret the biology: do genes of a particular type (AMR, virulence, or any other category the student defines) tend to co-occur or exclude one another in this species?

The tool covers steps 2 onward: it imports the pangenome matrix and identifies groups and representatives; it imports either annotation table from step 3; it imports both CoinFinder files from step 4; and it gives the student the filtering, tagging, and visualisation tools needed for step 5, including a route to notice associations they were not specifically looking for.

## Positioning within the Clann suite

Working name: **Clann Pangenome Explorer**. Suggested repository: `clann-pangenome-explorer`, hosted at `chriscreevey.github.io/clann-pangenome-explorer/`. Cross-links to the other two tools belong in the About section and footer, exactly as BLAST Explorer already links to Tree Viewer. This tool sits upstream of both: it identifies sequences and gene families worth extracting, and hands off IDs for BLAST searching or for alignment and tree building that can then be viewed in Tree Viewer.

## Input formats

### Pangenome matrix

Parse and normalise four formats into one common internal data model, rather than treating any one as canonical:

- **Roary**: `gene_presence_absence.csv`, with fixed metadata columns (Gene, Non-unique Gene name, Annotation, No. isolates, No. sequences, Avg sequences per isolate, genome fragment/order columns, QC, group-size columns) followed by one column per genome, each cell holding comma-separated gene IDs or blank.
- **Panaroo**: `gene_presence_absence.csv` (Roary-compatible) or `gene_presence_absence_roary.csv`, plus optional `gene_data.csv` for sequence-level detail. Column set is close to Roary's with minor naming differences.
- **PIRATE**: `PIRATE.gene_families.tsv`, with allele-level columns, a `threshold%` column, and per-genome columns of allele calls rather than raw gene IDs.
- **PanACoTA**: a pangenome matrix of families by genome (0/1 or copy-count), without the rich annotation columns the others provide.

Fall back to a generic CSV/TSV importer for anything else, or when auto-detection fails: preview the first rows, best-guess which column is the group ID and which columns are genomes, and let the user confirm or correct before loading, exactly as BLAST Explorer's no-header handling already works.

### Annotation of representatives or of all genes

Two workflows, supported equally, since students arrive with either depending on which variant of step 3 they ran.

**Workflow A - representative sequence annotated.** One annotation row per gene group, keyed to the representative sequence ID. Import directly and join onto groups.

**Workflow B - all genes annotated, then mapped to groups.** One annotation row per gene, across every genome, so a group can contain genes with different annotations. Roll this up to group level: tabulate the frequency of each distinct annotation among a group's constituent genes, report a consensus (majority) annotation and a consistency score, and apply a minimum-count or minimum-percentage filter before accepting a consensus call. Let the student browse the full disagreement breakdown for any group rather than hiding it behind the consensus label, since noticing that ambiguity is itself a useful teaching point.

### CoinFinder association and disassociation files

Import both of CoinFinder's output files: significantly associated pairs and significantly disassociated pairs. Treat each as a table of gene-group pairs with an associated statistic (CoinFinder's exact column names vary by version, so route this through the same generic-import column-mapping step used elsewhere, with best-guess defaults for the two gene-ID columns and the significance/probability column). Each pair is matched, on both sides, to the gene groups already loaded from the pangenome file, which is what makes the joined view possible. Pairs that fail to match an existing group (naming mismatches between CoinFinder's input and the currently loaded pangenome file) should be reported clearly rather than silently dropped, since this is a common source of confusion.

### Category tags (for example, AMR and virulence)

Add a lightweight tagging layer so the student can mark genes as belonging to a category of interest and immediately see it reflected everywhere else in the tool:

- **Keyword tagging**: type a term (or a few) and tag every group whose annotation text matches, useful as a quick first pass, for example matching "beta-lactamase" or "efflux" to build an ad hoc AMR tag.
- **List upload**: import a simple two-column file (group ID, category) for anyone who has already run a dedicated tool outside this app (for example CARD/RGI or a VFDB search) and has a curated gene list to bring in directly.
- Categories are just labels attached to groups; a group can hold more than one. Once defined, they feed the functional summary charts, the top-hit filters, and, most importantly, the association/disassociation module below.

## Common internal data model

Everything reduces to:

- **Groups** (rows): group ID, annotation (workflow A or B), consistency score (workflow B), category tags, derived pangenome stats.
- **Genomes** (columns): genome/isolate name.
- **Cells**: copy count per group per genome, and the specific gene/allele IDs where available.
- **Pairs**: gene-group A, gene-group B, direction (associated or disassociated), significance/probability value, resolved against the groups above.
- **Derived per group**: genomes present in, sequences total, average copies per genome, frequency class.
- **Derived per genome**: total genes, unique genes, core genes present (a basic QC signal for spotting a problem genome).

Frequency-class thresholds (core / soft-core / shell / cloud) should be user-adjustable, pre-filled with Roary's conventional defaults (core >=99%, soft-core 95-99%, shell 15-95%, cloud <15%).

## Core analyses

### Pangenome summary

- Group counts by frequency class (donut/bar chart plus a plain table).
- Gene frequency spectrum: histogram of the number of genomes each group is found in, the single most informative pangenome plot and worth making prominent.
- Pangenome and core-genome accumulation curves, built from client-side random subsampling permutations, capped and flagged as approximate for large genome sets.
- Presence/absence heatmap, sortable by frequency and by a lightweight client-side clustering, zoomable, exportable as SVG/PNG in the same style as Tree Viewer.
- Per-genome bar chart: total genes, unique genes, core genes present, useful for spotting an outlier genome (poor assembly, wrong species, contamination) at a glance.

### Top-hit / criteria-based analysis

- Filter and sort groups by frequency class, isolate/sequence counts, average copies per isolate (a paralogy signal), annotation text, and category tag.
- Presence/absence pattern matching against a defined subset of genomes, to pull out strain- or group-specific genes.
- Two-group comparison: split genomes into two sets and rank groups by a simple presence-difference score (a plain 2x2 contingency table and odds ratio, clearly labelled as descriptive rather than a formal test).
- Singleton/unique groups per genome, surfaced directly.
- Multi-copy family detection: groups above a configurable average-copies threshold, flagged as gene-family/reconciliation candidates, with a note pointing at Clann for the multi-copy supertree step.
- Filter by association status too, once CoinFinder data is loaded (for example, "show only groups that appear in at least one disassociation").

### Association and disassociation exploration (CoinFinder integration)

This is the module that ties the study together and is worth the most build attention.

- **Pair table**: every associated and disassociated pair, each side annotated with its own group's annotation, frequency class, and category tags, sortable and filterable by direction, significance, category, and frequency class.
- **Category-by-category summary**: a matrix (or grouped bar chart) of associated and disassociated pair counts broken down by category combination (AMR-AMR, AMR-virulence, AMR-uncategorised, and so on), giving a direct answer to "do AMR and virulence genes tend to co-occur in this species".
- **Network graph**: nodes are gene groups, coloured by category (or frequency class when no categories are defined), edges are pairs, styled distinctly for associated versus disassociated. Filterable by category, direction, and significance threshold; pannable and zoomable; exportable as SVG/PNG, matching Tree Viewer's interactive-SVG conventions. This is the view a student will screenshot for their report, so it deserves the same polish as Tree Viewer's tree canvas.
- **Unexpected-pair surfacing**: rather than trying to formally define "unexpected", give the student the tools to find it themselves. Highlight pairs that cross category boundaries (one tagged, one not, or two different tags), and separately allow sorting purely by significance regardless of category, so the strongest signals in the data are visible even before any tag has been applied. Both views should be reachable with one click from the pair table and the network graph, since this cross-category surfacing is exactly how an unanticipated association gets noticed.
- Handle pairs that reference a group with no annotation or no category gracefully. These are common and often the most interesting case (a well-characterised AMR gene turning up paired with a hypothetical protein), so they should be visible and filterable, not treated as missing data to be hidden.

## Staging data for downstream work

- A per-group detail card: group ID, annotation and consistency score, category tags, frequency class, isolate/sequence counts, average copies, and a collapsible list of constituent gene IDs by genome.
- Export constituent gene IDs for a selected group or filtered set, ready for sequence extraction from a genomes FASTA or GFF set.
- Export the gene-family/reconciliation candidate list (multi-copy groups) separately, as a feeder into Clann.
- Export a filtered pair table (for example, all cross-category associations above a chosen significance threshold) as CSV/TSV, and the network view as SVG/PNG, for direct use in a report.
- Link out to BLAST Explorer and Tree Viewer from the export panel where relevant, for example "extract these sequences, then explore hits in Clann BLAST Explorer" or "align and build a tree, then view it in Clann Tree Viewer".

## Visualisations, summarised

- Frequency-class donut/bar chart.
- Gene frequency spectrum histogram.
- Pangenome and core accumulation curves.
- Presence/absence heatmap, sortable/clustered, zoomable, exportable.
- Per-genome gene-count bar chart.
- Category summary bar chart.
- Two-group comparison chart for presence-difference ranking.
- Category-by-category association/disassociation matrix.
- Association/disassociation network graph.

All charts should be hand-rolled SVG/Canvas, matching the existing suite's dependency-free approach. Reuse whatever lightweight CSV/gzip/zip parsing helpers BLAST Explorer already uses, rather than introducing a new library.

## Site conventions to replicate exactly

- Same meta block pattern: title, description, keywords, canonical URL, Open Graph and Twitter card tags, `og-image.png`.
- "Everything runs locally; nothing is uploaded to a server" messaging, stated plainly, as the core trust proposition of the suite.
- Drag-and-drop file loading, an explicit "Open file..." button, and a paste-text option.
- Compressed file support (`.gz`/`.zip`), decompressed client-side.
- Responsive layout with resizable panels, working at both desktop and narrower window widths.
- Identical footer structure: "developed by CreeveyLab" · Feedback (GitHub issues link) · GitHub (source link) · "★ Like it?" (star link).
- An "About & FAQ" section below the fold, in the same plain question-and-answer style as the other two tools.
- `sitemap.xml` and `robots.txt` alongside the existing suite conventions.
- Undo/Reset controls on the filter panel.

## Technical approach

Vanilla HTML, CSS, and JavaScript, no build step, single page, matching both existing tools exactly. Client-side only, hosted on GitHub Pages, with no server-side component of any kind.

## Out of scope

- Running Roary, Panaroo, PIRATE, PanACoTA, CoinFinder, Prokka, Bakta, or any other pipeline.
- Running BLAST, DIAMOND, or any sequence search.
- Building alignments or phylogenetic trees.
- Automatic annotation of any sequence.
- Formal statistical testing beyond simple, clearly labelled descriptive measures.

The tool's job is to make sense of output that already exists, join it up, and stage the next step clearly, not to replace any part of the pipeline.

## Suggested build phases

1. Parsers and common data model for Roary, Panaroo, PIRATE, PanACoTA, plus generic CSV/TSV fallback with column mapping.
2. Pangenome summary: frequency classes, frequency spectrum, per-genome gene counts.
3. Presence/absence heatmap and accumulation curves.
4. Filtering and top-hit workflows: pattern matching, two-group comparison, singleton/multi-copy detection.
5. Annotation mapping, both workflows, including consensus/consistency handling for the all-genes route, plus category tagging (keyword and list-upload).
6. CoinFinder import, pair table, category-by-category matrix, network graph, unexpected-pair surfacing.
7. Export and staging: ID lists, FASTA-ready subsets, gene-family candidate export, pair/network export, cross-links to Tree Viewer and BLAST Explorer.
8. Site chrome and polish: meta tags, footer, About/FAQ, sitemap, responsive layout pass.

## Open points for discussion

- Which frequency-class thresholds to pre-fill as defaults, and whether these should be editable per session or fixed.
- Whether the two-group comparison statistic should stay purely descriptive (odds ratio only) or extend to a simple significance indicator, and how that should be caveated for a student audience.
- Naming for the multi-copy/gene-family candidate export, to keep terminology consistent with Clann's own documentation.
- Whether category tags should support a hierarchy (for example, a broad "AMR" tag with narrower mechanism-specific sub-tags) or stay as a flat label set for simplicity.
- How much weight the "unexpected pairs" view should give to statistical significance versus category novelty, since these can pull in different directions and the balance affects what a student is likely to notice first.
