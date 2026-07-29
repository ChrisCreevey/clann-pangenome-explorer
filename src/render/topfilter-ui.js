// topfilter-ui.js — Phase 4 UI: the sidebar "Filters" panel (static markup
// in index.html) plus four main-panel cards: the "Groups" table (mounted
// via mountGroupsCard, right after the frequency-class summary), pattern
// matching, two-group comparison, and singleton/multi-copy detection
// (the latter three mounted via mountTopFilterExtras, further down).
//
// The sidebar controls are static HTML that persists across file loads
// (mountExplorer rebuilds the main panel from scratch each time but not
// the sidebar), so their event listeners are bound exactly once at module
// load and dispatch through a module-level `active` callback that
// mountGroupsCard() reassigns on every mount — this avoids stacking a
// new listener (and a new Undo history) on top of the old one each time a
// new file is loaded.

import { filterGroups, patternMatch, twoGroupComparison, singletonsPerGenome, multiCopyCandidates, isNumericColumn, genomeNamesForPhenotypeValue } from "../analysis/topfilter.js";
import { listTags } from "../analysis/tags.js";
import { renderSingletonBarChart, renderMultiCopyHistogram } from "./charts.js";
import { renderGroupTable, DEFAULT_COLS, COL_LABELS } from "./group-table.js";
import { openGroupDetail } from "./group-detail.js";
import { downloadText } from "./download-util.js";
import { geneIdListText, geneIdTableCsv, groupTableCsv, multiCopyCandidatesCsv, MULTICOPY_EXPORT_FILENAME } from "../../export/group-export.js";
import { runBusy } from "./busy.js";

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function card(titleText) {
  const c = document.createElement("div");
  c.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = titleText;
  c.appendChild(h3);
  return c;
}

/**
 * Column list + labels + which are numeric — shared between the Groups
 * table and the sidebar's column-filter dropdown so both always offer
 * exactly the same set, including one entry per uploaded annotation
 * source (and its "matched genes" count column for Workflow B sources).
 */
function buildGroupColumns(data) {
  const columns = [...DEFAULT_COLS];
  const columnLabels = { ...COL_LABELS };
  const numericColumns = ["genomesPresentIn", "sequencesTotal", "avgCopiesPerGenome"];
  for (const source of data.meta.annotationSources || []) {
    columns.push(`ann_${source.key}`);
    columnLabels[`ann_${source.key}`] = source.header;
    if (source.workflow === "B") {
      columns.push(`annMatched_${source.key}`);
      columnLabels[`annMatched_${source.key}`] = `${source.header} — matched genes`;
      numericColumns.push(`annMatched_${source.key}`);
    }
  }
  columns.push("tags");
  return { columns, columnLabels, numericColumns };
}

function readSidebarCriteria() {
  const freqClasses = [...document.querySelectorAll(".fFreqClass:checked")].map((cb) => cb.value);
  const column = document.getElementById("fColumn").value;
  const columnFilter = isNumericColumn(column)
    ? {
      column, mode: "numeric",
      op: document.getElementById("fColumnOp").value,
      value: document.getElementById("fColumnValue").value ? Number(document.getElementById("fColumnValue").value) : undefined,
    }
    : { column, mode: "text", text: document.getElementById("fColumnText").value.trim() || undefined };
  const minGenomesPresentIn = document.getElementById("fMinGenomes").value
    ? Number(document.getElementById("fMinGenomes").value) : undefined;
  const maxGenomesPresentIn = document.getElementById("fMaxGenomes").value
    ? Number(document.getElementById("fMaxGenomes").value) : undefined;
  const minAvgCopiesPerGenome = document.getElementById("fMinAvgCopies").value
    ? Number(document.getElementById("fMinAvgCopies").value) : undefined;
  const tags = [...document.querySelectorAll(".fTagCheckbox:checked")].map((cb) => cb.value);
  const hasAnnotationValue = [...document.querySelectorAll(".fAnnSourceCheckbox:checked")].map((cb) => cb.value);
  const missingAnnotationValue = [...document.querySelectorAll(".fAnnMissingCheckbox:checked")].map((cb) => cb.value);
  return { freqClasses, columnFilter, minGenomesPresentIn, maxGenomesPresentIn, minAvgCopiesPerGenome, tags, hasAnnotationValue, missingAnnotationValue };
}

/** Show the text-contains box for a text column, or the operator+value pair for a numeric one. */
function updateColumnFilterMode() {
  const numeric = isNumericColumn(document.getElementById("fColumn").value);
  document.getElementById("fColumnTextRow").style.display = numeric ? "none" : "";
  document.getElementById("fColumnText").style.display = numeric ? "none" : "";
  document.getElementById("fColumnNumericRow").style.display = numeric ? "" : "none";
}

function writeSidebarCriteria(criteria) {
  document.querySelectorAll(".fFreqClass").forEach((cb) => {
    cb.checked = !criteria.freqClasses || !criteria.freqClasses.length || criteria.freqClasses.includes(cb.value);
  });
  const cf = criteria.columnFilter || {};
  if (cf.column) document.getElementById("fColumn").value = cf.column;
  document.getElementById("fColumnText").value = cf.text || "";
  document.getElementById("fColumnOp").value = cf.op || ">";
  document.getElementById("fColumnValue").value = cf.value ?? "";
  updateColumnFilterMode();
  document.getElementById("fMinGenomes").value = criteria.minGenomesPresentIn ?? "";
  document.getElementById("fMaxGenomes").value = criteria.maxGenomesPresentIn ?? "";
  document.getElementById("fMinAvgCopies").value = criteria.minAvgCopiesPerGenome ?? "";
  document.querySelectorAll(".fTagCheckbox").forEach((cb) => {
    cb.checked = !!(criteria.tags && criteria.tags.includes(cb.value));
  });
  document.querySelectorAll(".fAnnSourceCheckbox").forEach((cb) => {
    cb.checked = !!(criteria.hasAnnotationValue && criteria.hasAnnotationValue.includes(cb.value));
  });
  document.querySelectorAll(".fAnnMissingCheckbox").forEach((cb) => {
    cb.checked = !!(criteria.missingAnnotationValue && criteria.missingAnnotationValue.includes(cb.value));
  });
}

const DEFAULT_CRITERIA = { freqClasses: ["core", "softcore", "shell", "cloud"], columnFilter: { column: "annotation", mode: "text", text: undefined }, minGenomesPresentIn: undefined, maxGenomesPresentIn: undefined, minAvgCopiesPerGenome: undefined, tags: [], hasAnnotationValue: [], missingAnnotationValue: [] };

/** Rebuild the column-filter dropdown from the Groups table's current column set, preserving the selected column if it still exists. */
function populateColumnFilterOptions(data) {
  const select = document.getElementById("fColumn");
  const previous = select.value;
  const { columns, columnLabels } = buildGroupColumns(data);
  select.innerHTML = columns.map((col) => `<option value="${col}">${columnLabels[col] || col}</option>`).join("");
  select.value = columns.includes(previous) ? previous : "annotation";
  updateColumnFilterMode();
}

/** Rebuild the tag checkboxes in the sidebar from the tags currently in use, preserving any that are still checked. */
function populateTagCheckboxes(data) {
  const row = document.getElementById("fTagsRow");
  const container = document.getElementById("fTagsContainer");
  const previouslyChecked = new Set([...container.querySelectorAll(".fTagCheckbox:checked")].map((cb) => cb.value));
  const tags = listTags(data);
  row.style.display = tags.length ? "" : "none";
  container.innerHTML = tags.map(({ tag, count }) => `
    <label class="row"><input type="checkbox" class="fTagCheckbox" value="${tag}" ${previouslyChecked.has(tag) ? "checked" : ""}> ${tag} (${count})</label>
  `).join("");
  container.querySelectorAll(".fTagCheckbox").forEach((cb) => cb.addEventListener("change", () => applyCriteria(readSidebarCriteria())));
}

/** Rebuild one "has/missing a value from" checkbox group from the annotation sources currently loaded, preserving any that are still checked. */
function populateAnnotationCheckboxGroup(data, rowId, containerId, checkboxClass) {
  const row = document.getElementById(rowId);
  const container = document.getElementById(containerId);
  const previouslyChecked = new Set([...container.querySelectorAll(`.${checkboxClass}:checked`)].map((cb) => cb.value));
  const sources = data.meta.annotationSources || [];
  row.style.display = sources.length ? "" : "none";
  container.innerHTML = sources.map(({ key, header }) => `
    <label class="row"><input type="checkbox" class="${checkboxClass}" value="${key}" ${previouslyChecked.has(key) ? "checked" : ""}> ${header}</label>
  `).join("");
  container.querySelectorAll(`.${checkboxClass}`).forEach((cb) => cb.addEventListener("change", () => applyCriteria(readSidebarCriteria())));
}

function populateAnnotationSourceCheckboxes(data) {
  populateAnnotationCheckboxGroup(data, "fAnnSourcesRow", "fAnnSourcesContainer", "fAnnSourceCheckbox");
  populateAnnotationCheckboxGroup(data, "fAnnMissingRow", "fAnnMissingContainer", "fAnnMissingCheckbox");
}

// module-level state, reassigned by mountGroupsCard() on every mount
let active = null; // { data, groupTableHandle, history: [criteria,...] }

function applyCriteria(criteria, { pushHistory = true } = {}) {
  if (!active) return;
  if (pushHistory) active.history.push(criteria);
  // filterGroups() is O(groups), and setGroups()/onFilterChange() (which
  // also drives the heatmap's row subset) each re-sort and redraw their
  // whole table/canvas — cheap for a typical study, but for a very large
  // pangenome this can take real wall-clock time, so run it under the busy
  // spinner rather than leaving a filter checkbox looking unresponsive.
  runBusy(() => {
    active.currentGroups = filterGroups(active.data, criteria);
    active.groupTableHandle.setGroups(active.currentGroups);
    active.onFilterChange?.(active.currentGroups);
    document.getElementById("fUndo").disabled = active.history.length <= 1;
    updateFilteredCount();
    active.filteredCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function updateFilteredCount() {
  if (!active || !active.countEl) return;
  active.countEl.textContent = `${active.currentGroups.length}/${active.data.groups.length} groups selected`;
}

// --- bind sidebar listeners exactly once ---
let sidebarBound = false;
function bindSidebarOnce() {
  if (sidebarBound) return;
  sidebarBound = true;

  const onChange = () => applyCriteria(readSidebarCriteria());
  // Typing in a text/number filter re-sorts and fully redraws the Groups
  // table on every keystroke (no row cap — see group-table.js), so debounce
  // those specifically; checkbox clicks are already discrete and stay instant.
  const onChangeDebounced = debounce(onChange, 200);
  document.querySelectorAll(".fFreqClass").forEach((cb) => cb.addEventListener("change", onChange));
  document.getElementById("fColumn").addEventListener("change", () => { updateColumnFilterMode(); onChange(); });
  document.getElementById("fColumnText").addEventListener("input", onChangeDebounced);
  document.getElementById("fColumnOp").addEventListener("change", onChange);
  document.getElementById("fColumnValue").addEventListener("input", onChangeDebounced);
  document.getElementById("fMinGenomes").addEventListener("input", onChangeDebounced);
  document.getElementById("fMaxGenomes").addEventListener("input", onChangeDebounced);
  document.getElementById("fMinAvgCopies").addEventListener("input", onChangeDebounced);

  document.getElementById("fUndo").addEventListener("click", () => {
    if (!active || active.history.length <= 1) return;
    active.history.pop(); // discard current
    const previous = active.history[active.history.length - 1];
    writeSidebarCriteria(previous);
    applyCriteria(previous, { pushHistory: false });
  });

  document.getElementById("fReset").addEventListener("click", () => {
    if (!active) return;
    writeSidebarCriteria(DEFAULT_CRITERIA);
    active.history = [];
    applyCriteria(DEFAULT_CRITERIA);
  });
}

function parseGenomeList(text) {
  return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function renderPatternMatchCard(panel, data) {
  const c = card("Presence/absence pattern matching");
  c.innerHTML += `
    <div class="row"><label>Present in (comma-separated genome names)</label></div>
    <input type="text" id="pmPresentIn" placeholder="e.g. genome_001, genome_002">
    <div class="row"><label>Absent from (comma-separated genome names)</label></div>
    <input type="text" id="pmAbsentFrom" placeholder="e.g. genome_010">
    <button class="act" id="pmRun" style="width:auto">Find matching groups</button>
  `;
  const resultDiv = document.createElement("div");
  resultDiv.style.marginTop = "10px";
  c.appendChild(resultDiv);
  panel.appendChild(c);

  c.querySelector("#pmRun").addEventListener("click", () => {
    const presentIn = parseGenomeList(c.querySelector("#pmPresentIn").value);
    const absentFrom = parseGenomeList(c.querySelector("#pmAbsentFrom").value);
    const unknown = [...presentIn, ...absentFrom].filter((name) => !data.genomes.some((g) => g.name === name));
    if (unknown.length) {
      resultDiv.innerHTML = `<div class="hint">Unrecognised genome name(s): ${unknown.join(", ")}</div>`;
      return;
    }
    const hits = patternMatch(data, { presentIn, absentFrom });
    renderGroupTable(resultDiv, hits, { onRowClick: (group) => openGroupDetail(data, group) });
  });
}

/**
 * The comma-separated text inputs remain the primary, always-available way
 * to build a genome set — but typing hundreds of genome names by hand was
 * never really practical once a study has more than a couple dozen
 * genomes. When a genome-metadata file has been loaded (src/parse/genome-
 * metadata.js), this adds a second way to fill the same two inputs: pick a
 * phenotype column and two of its values, and the matching genome names
 * are filled in automatically (still hand-editable afterward). This reuses
 * twoGroupComparison() and the result table completely unchanged — the
 * only new thing is how genomesA/genomesB get built.
 */
function wirePhenotypeSetBuilder(c, data) {
  const phenotypeSources = data.meta.phenotypeSources || [];
  if (!phenotypeSources.length) return;

  const colSelect = c.querySelector("#tgPhenoCol");
  const levelASelect = c.querySelector("#tgLevelA");
  const levelBSelect = c.querySelector("#tgLevelB");
  const coverageDiv = c.querySelector("#tgPhenoCoverage");
  const tgA = c.querySelector("#tgA"), tgB = c.querySelector("#tgB");

  for (const source of phenotypeSources) {
    const opt = document.createElement("option");
    opt.value = source.key;
    opt.textContent = source.header;
    colSelect.appendChild(opt);
  }

  function fillFromPhenotype() {
    const key = colSelect.value;
    const levelA = levelASelect.value, levelB = levelBSelect.value;
    if (!key || !levelA || !levelB) return;
    const genomesA = genomeNamesForPhenotypeValue(data, key, levelA);
    const genomesB = genomeNamesForPhenotypeValue(data, key, levelB);
    tgA.value = genomesA.join(", ");
    tgB.value = genomesB.join(", ");
    const total = data.genomes.length;
    const excluded = total - genomesA.length - genomesB.length;
    coverageDiv.textContent = levelA === levelB
      ? "Level A and Level B must be different to compare."
      : `Comparing ${genomesA.length} genome(s) (${levelA}) vs ${genomesB.length} genome(s) (${levelB}) — ${excluded} of ${total} total genome(s) not included (no value, or a different level, for this phenotype).`;
  }

  function populateLevels() {
    const source = phenotypeSources.find((s) => s.key === colSelect.value);
    const values = (source && source.distinctValues) || [];
    for (const select of [levelASelect, levelBSelect]) {
      select.innerHTML = "";
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
    }
    if (values.length > 1) levelBSelect.selectedIndex = 1; // default A/B to two different values, not the same one twice
    fillFromPhenotype();
  }

  colSelect.addEventListener("change", populateLevels);
  levelASelect.addEventListener("change", fillFromPhenotype);
  levelBSelect.addEventListener("change", fillFromPhenotype);
  populateLevels();
}

function renderTwoGroupCard(panel, data) {
  const c = card("Two-group comparison");
  const hasPhenotypes = (data.meta.phenotypeSources || []).length > 0;
  c.innerHTML += `
    <div class="hint">Descriptive odds ratio only — not a formal significance test.</div>
    ${hasPhenotypes ? `
    <div class="row"><label for="tgPhenoCol">Build from phenotype</label></div>
    <select id="tgPhenoCol"></select>
    <div class="row"><label for="tgLevelA">Level A</label></div>
    <select id="tgLevelA"></select>
    <div class="row"><label for="tgLevelB">Level B</label></div>
    <select id="tgLevelB"></select>
    <div class="hint" id="tgPhenoCoverage"></div>
    ` : ""}
    <div class="row"><label>Genome set A (comma-separated)</label></div>
    <input type="text" id="tgA" placeholder="e.g. genome_001, genome_002">
    <div class="row"><label>Genome set B (comma-separated)</label></div>
    <input type="text" id="tgB" placeholder="e.g. genome_010, genome_011">
    <button class="act" id="tgRun" style="width:auto">Compare</button>
  `;
  const resultDiv = document.createElement("div");
  resultDiv.style.marginTop = "10px";
  c.appendChild(resultDiv);
  panel.appendChild(c);

  wirePhenotypeSetBuilder(c, data);

  c.querySelector("#tgRun").addEventListener("click", () => {
    const genomesA = parseGenomeList(c.querySelector("#tgA").value);
    const genomesB = parseGenomeList(c.querySelector("#tgB").value);
    const unknown = [...genomesA, ...genomesB].filter((name) => !data.genomes.some((g) => g.name === name));
    if (unknown.length) {
      resultDiv.innerHTML = `<div class="hint">Unrecognised genome name(s): ${unknown.join(", ")}</div>`;
      return;
    }
    if (!genomesA.length || !genomesB.length) {
      resultDiv.innerHTML = `<div class="hint">Enter at least one genome in each set.</div>`;
      return;
    }
    const rows = twoGroupComparison(data, genomesA, genomesB);
    renderGroupTable(resultDiv, rows, {
      columns: ["groupId", "annotation", "presentA", "presentB", "pctA", "pctB", "oddsRatio"],
      defaultSort: "pctA",
    });
  });
}

function renderSingletonMultiCopyCard(panel, data) {
  const c = card("Singletons and multi-copy candidates");
  c.innerHTML += `
    <h4>Singleton groups per genome</h4>
    <div class="hint">A genome that's an outlier here — far more singleton (unique-to-it) groups than the rest — is a data-quality signal worth checking: a poor assembly, a mislabeled sample, or contamination, rather than real biology.</div>
    <div id="singletonChart"></div>
    <h4>Multi-copy family candidates</h4>
    <div class="hint">Groups averaging well above 1 copy/genome are usually a paralogous gene family Roary/Panaroo/PIRATE couldn't cleanly split into one ortholog per genome — a feeder into Clann's multi-copy supertree step, not something presence/absence counting alone can resolve.</div>
    <div class="row"><label for="mcThreshold">Min avg copies per genome</label></div>
    <input type="number" id="mcThreshold" min="0" step="0.1" value="1.5">
    <div id="mcHist"></div>
    <button class="act" id="mcExport" style="width:auto">Export ${MULTICOPY_EXPORT_FILENAME}</button>
    <div class="hint">Align and build a multi-copy gene-family supertree, then view it in <a href="https://chriscreevey.github.io/clann-tree-viewer/" target="_blank" rel="noopener">Clann Tree Viewer</a>.</div>
    <div id="mcTable" style="margin-top:10px"></div>
  `;
  panel.appendChild(c);

  const singletonDiv = c.querySelector("#singletonChart");
  const mcHistDiv = c.querySelector("#mcHist");
  const multiCopyDiv = c.querySelector("#mcTable");

  const byGenome = singletonsPerGenome(data);
  renderSingletonBarChart(singletonDiv, byGenome);

  let currentMultiCopy = [];
  function drawMultiCopy() {
    const threshold = Number(c.querySelector("#mcThreshold").value) || 0;
    currentMultiCopy = multiCopyCandidates(data, threshold);
    renderMultiCopyHistogram(mcHistDiv, currentMultiCopy);
    renderGroupTable(multiCopyDiv, currentMultiCopy, { defaultSort: "avgCopiesPerGenome", onRowClick: (group) => openGroupDetail(data, group) });
  }
  c.querySelector("#mcThreshold").addEventListener("input", drawMultiCopy);
  c.querySelector("#mcExport").addEventListener("click", () => downloadText(MULTICOPY_EXPORT_FILENAME, multiCopyCandidatesCsv(currentMultiCopy), "text/csv"));
  drawMultiCopy();
}

/**
 * Mount the "Groups" card (the sidebar-filtered group table) into `panel`.
 * Placed right after the frequency-class summary so the detailed group
 * list is upfront, ahead of the other summary charts. `opts.onFilterChange`
 * (optional) is called with the new filtered group list on every filter
 * edit — used to keep the heatmap's rows in sync with the sidebar filters.
 */
export function mountGroupsCard(panel, data, opts = {}) {
  bindSidebarOnce();
  populateTagCheckboxes(data);
  populateAnnotationSourceCheckboxes(data);
  populateColumnFilterOptions(data);

  const filteredCard = card("Groups");
  filteredCard.id = "filteredGroupsCard";
  const countEl = document.createElement("div");
  countEl.className = "hint";
  countEl.id = "filteredGroupsCount";
  filteredCard.appendChild(countEl);
  const exportRow = document.createElement("div");
  exportRow.className = "chart-controls";
  exportRow.innerHTML = `
    <button class="act" id="filteredExportIds" style="width:auto">Export gene IDs (.txt)</button>
    <button class="act" id="filteredExportGeneTable" style="width:auto">Export gene ID table (.csv)</button>
    <button class="act" id="filteredExportCsv" style="width:auto">Export table (.csv)</button>
  `;
  filteredCard.appendChild(exportRow);
  const tableDiv = document.createElement("div");
  filteredCard.appendChild(tableDiv);
  panel.appendChild(filteredCard);

  const { columns, columnLabels, numericColumns } = buildGroupColumns(data);

  const groupTableHandle = renderGroupTable(tableDiv, filterGroups(data, DEFAULT_CRITERIA), { columns, columnLabels, numericColumns, onRowClick: (group) => openGroupDetail(data, group) });

  active = { data, groupTableHandle, history: [DEFAULT_CRITERIA], currentGroups: filterGroups(data, DEFAULT_CRITERIA), filteredCard, countEl, onFilterChange: opts.onFilterChange };
  writeSidebarCriteria(DEFAULT_CRITERIA);
  document.getElementById("fUndo").disabled = true;
  updateFilteredCount();

  exportRow.querySelector("#filteredExportIds").addEventListener("click", () => downloadText("filtered-groups-gene-ids.txt", geneIdListText(data, active.currentGroups)));
  exportRow.querySelector("#filteredExportGeneTable").addEventListener("click", () => downloadText("filtered-groups-gene-ids.csv", geneIdTableCsv(data, active.currentGroups), "text/csv"));
  exportRow.querySelector("#filteredExportCsv").addEventListener("click", () => downloadText("filtered-groups.csv", groupTableCsv(active.data, active.currentGroups), "text/csv"));
  const crossLink = document.createElement("div");
  crossLink.className = "hint";
  crossLink.innerHTML = `This tool doesn't extract sequences itself — pangenome tools take one annotated file per genome, not a single merged one, so gene IDs are typically only unique <em>within</em> a genome, not across your whole set. Use the gene ID <strong>table</strong> export (not the flat list) — it keeps each gene ID paired with its genome — and look each one up in that <em>same</em> genome's own sequence file (a Prokka/Bakta <code>.ffn</code>/<code>.faa</code> is easiest: no coordinate math needed). Per genome, e.g.: <code>seqtk subseq genome_name.ffn &lt;(awk -F, -v g=genome_name '$2==g{print $3}' filtered-groups-gene-ids.csv) &gt; extracted.fasta</code> — then stage hits in <a href="https://chriscreevey.github.io/clann-blast-explorer/" target="_blank" rel="noopener">Clann BLAST Explorer</a>.`;
  filteredCard.appendChild(crossLink);
}

/** Mount the remaining Phase 4 cards (pattern matching, two-group comparison, singleton/multi-copy) into `panel`. */
export function mountTopFilterExtras(panel, data) {
  renderPatternMatchCard(panel, data);
  renderTwoGroupCard(panel, data);
  renderSingletonMultiCopyCard(panel, data);
}
