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

import { filterGroups, patternMatch, twoGroupComparison, singletonsPerGenome, multiCopyCandidates } from "../analysis/topfilter.js";
import { listTags } from "../analysis/tags.js";
import { renderGroupTable, DEFAULT_COLS } from "./group-table.js";
import { openGroupDetail } from "./group-detail.js";
import { downloadText } from "./download-util.js";
import { geneIdListText, groupTableCsv, multiCopyCandidatesCsv, MULTICOPY_EXPORT_FILENAME } from "../../export/group-export.js";

function card(titleText) {
  const c = document.createElement("div");
  c.className = "card";
  const h3 = document.createElement("h3");
  h3.textContent = titleText;
  c.appendChild(h3);
  return c;
}

function readSidebarCriteria() {
  const freqClasses = [...document.querySelectorAll(".fFreqClass:checked")].map((cb) => cb.value);
  const annotationText = document.getElementById("fAnnotationText").value.trim() || undefined;
  const minGenomesPresentIn = document.getElementById("fMinGenomes").value
    ? Number(document.getElementById("fMinGenomes").value) : undefined;
  const maxGenomesPresentIn = document.getElementById("fMaxGenomes").value
    ? Number(document.getElementById("fMaxGenomes").value) : undefined;
  const minAvgCopiesPerGenome = document.getElementById("fMinAvgCopies").value
    ? Number(document.getElementById("fMinAvgCopies").value) : undefined;
  const tags = [...document.querySelectorAll(".fTagCheckbox:checked")].map((cb) => cb.value);
  const hasAnnotationValue = [...document.querySelectorAll(".fAnnSourceCheckbox:checked")].map((cb) => cb.value);
  const missingAnnotationValue = [...document.querySelectorAll(".fAnnMissingCheckbox:checked")].map((cb) => cb.value);
  return { freqClasses, annotationText, minGenomesPresentIn, maxGenomesPresentIn, minAvgCopiesPerGenome, tags, hasAnnotationValue, missingAnnotationValue };
}

function writeSidebarCriteria(criteria) {
  document.querySelectorAll(".fFreqClass").forEach((cb) => {
    cb.checked = !criteria.freqClasses || !criteria.freqClasses.length || criteria.freqClasses.includes(cb.value);
  });
  document.getElementById("fAnnotationText").value = criteria.annotationText || "";
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

const DEFAULT_CRITERIA = { freqClasses: ["core", "softcore", "shell", "cloud"], annotationText: undefined, minGenomesPresentIn: undefined, maxGenomesPresentIn: undefined, minAvgCopiesPerGenome: undefined, tags: [], hasAnnotationValue: [], missingAnnotationValue: [] };

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
  active.currentGroups = filterGroups(active.data, criteria);
  active.groupTableHandle.setGroups(active.currentGroups);
  active.onFilterChange?.(active.currentGroups);
  document.getElementById("fUndo").disabled = active.history.length <= 1;
  updateFilteredCount();
  active.filteredCard?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.querySelectorAll(".fFreqClass").forEach((cb) => cb.addEventListener("change", onChange));
  document.getElementById("fAnnotationText").addEventListener("input", onChange);
  document.getElementById("fMinGenomes").addEventListener("input", onChange);
  document.getElementById("fMaxGenomes").addEventListener("input", onChange);
  document.getElementById("fMinAvgCopies").addEventListener("input", onChange);

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

function renderTwoGroupCard(panel, data) {
  const c = card("Two-group comparison");
  c.innerHTML += `
    <div class="hint">Descriptive odds ratio only — not a formal significance test.</div>
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
    <div class="hint" id="singletonSummary"></div>
    <h4>Multi-copy family candidates</h4>
    <div class="hint">A feeder into Clann's multi-copy supertree step.</div>
    <div class="row"><label for="mcThreshold">Min avg copies per genome</label></div>
    <input type="number" id="mcThreshold" min="0" step="0.1" value="1.5">
    <button class="act" id="mcExport" style="width:auto">Export ${MULTICOPY_EXPORT_FILENAME}</button>
    <div class="hint">Align and build a multi-copy gene-family supertree, then view it in <a href="https://chriscreevey.github.io/clann-tree-viewer/" target="_blank" rel="noopener">Clann Tree Viewer</a>.</div>
  `;
  const multiCopyDiv = document.createElement("div");
  multiCopyDiv.style.marginTop = "10px";
  c.appendChild(multiCopyDiv);
  panel.appendChild(c);

  const byGenome = singletonsPerGenome(data);
  const summary = [...byGenome.entries()]
    .filter(([, groups]) => groups.length)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, groups]) => `${name}: ${groups.length}`)
    .join(" · ") || "No singleton (genome-unique) groups found.";
  c.querySelector("#singletonSummary").textContent = summary;

  let currentMultiCopy = [];
  function drawMultiCopy() {
    const threshold = Number(c.querySelector("#mcThreshold").value) || 0;
    currentMultiCopy = multiCopyCandidates(data, threshold);
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
    <button class="act" id="filteredExportCsv" style="width:auto">Export table (.csv)</button>
  `;
  filteredCard.appendChild(exportRow);
  const tableDiv = document.createElement("div");
  filteredCard.appendChild(tableDiv);
  panel.appendChild(filteredCard);

  const columns = [...DEFAULT_COLS];
  const columnLabels = {};
  const numericColumns = [];
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

  const groupTableHandle = renderGroupTable(tableDiv, filterGroups(data, DEFAULT_CRITERIA), { columns, columnLabels, numericColumns, onRowClick: (group) => openGroupDetail(data, group) });

  active = { data, groupTableHandle, history: [DEFAULT_CRITERIA], currentGroups: filterGroups(data, DEFAULT_CRITERIA), filteredCard, countEl, onFilterChange: opts.onFilterChange };
  writeSidebarCriteria(DEFAULT_CRITERIA);
  document.getElementById("fUndo").disabled = true;
  updateFilteredCount();

  exportRow.querySelector("#filteredExportIds").addEventListener("click", () => downloadText("filtered-groups-gene-ids.txt", geneIdListText(data, active.currentGroups)));
  exportRow.querySelector("#filteredExportCsv").addEventListener("click", () => downloadText("filtered-groups.csv", groupTableCsv(active.data, active.currentGroups), "text/csv"));
  const crossLink = document.createElement("div");
  crossLink.className = "hint";
  crossLink.innerHTML = `Extract these sequences from your genome FASTA/GFF set, then explore hits in <a href="https://chriscreevey.github.io/clann-blast-explorer/" target="_blank" rel="noopener">Clann BLAST Explorer</a>.`;
  filteredCard.appendChild(crossLink);
}

/** Mount the remaining Phase 4 cards (pattern matching, two-group comparison, singleton/multi-copy) into `panel`. */
export function mountTopFilterExtras(panel, data) {
  renderPatternMatchCard(panel, data);
  renderTwoGroupCard(panel, data);
  renderSingletonMultiCopyCard(panel, data);
}
